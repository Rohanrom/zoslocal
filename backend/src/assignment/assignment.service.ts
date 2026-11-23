import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAssignmentRunDto } from './dto/create-assignment-run.dto';
import { SubmitReportingDto } from './dto/submit-reporting.dto';
import { AddDemandToRecommendationDto } from './dto/add-demand-to-recommendation.dto';
import { RemoveRecommendationDto } from './dto/remove-recommendation.dto';
import { UpdateRecommendationPaintersDto } from './dto/update-recommendation-painters.dto';
import { UpdateRecommendationScopeDto } from './dto/update-recommendation-scope.dto';
import { UpdateReportedBackendRowDto } from './dto/update-reported-backend-row.dto';
import { BulkSubmitAssignedReportingDto } from './dto/bulk-submit-assigned-reporting.dto';
import { GenerateRecommendationsDto } from './dto/generate-recommendations.dto';

@Injectable()
export class AssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly PROJECT_SCHEMA_MAP = {
    indradhanush: 'indr',
    park_heights: 'indr',
  } as const;

  /**
   * Jibble location names are intentionally kept separate from the existing
   * project/site names used by the Assignment Engine. Jibble's APH location is
   * exported as "Adarsh Park Heights", while the existing capacity logic uses
   * "Park Heights". Keeping this mapping isolated prevents any change to the
   * existing assignment-capacity flow.
   */
  private readonly JIBBLE_LOCATION_BY_PROJECT: Record<string, string> = {
    park_heights: 'Adarsh Park Heights',
    indradhanush: 'Indradhanush',
  };

  private readonly JIBBLE_TIMEZONE = 'Asia/Kolkata';

  // These are existing production projects whose current Assignment behavior
  // must remain completely unchanged, not a list of allowed project IDs.
  private readonly LEGACY_ASSIGNMENT_PROJECTS = [
    'indradhanush',
    'park_heights',
  ];

  private readonly ASSIGNMENT_LONG_TRANSACTION_OPTIONS = {
    maxWait: 20000,
    timeout: 180000,
  } as const;

  private assertAssignmentProject(projectId: string) {
    // Module visibility is universal. Queries in this service are scoped to
    // project_id. An empty or malformed project ID must not be accepted.
    if (!projectId || !/^[a-z0-9_-]+$/.test(projectId)) {
      throw new BadRequestException('A valid project ID is required');
    }
  }

  /**
   * New project mutations require the structural masters before creating runs.
   * Recommendations additionally need project-linked painters. This checks
   * presence only: painter_availability and its existing capacity function
   * are deliberately NOT modified or made a new universal prerequisite.
   * No new checks are imposed on Park Heights or Indradhanush.
   */
  private async assertNewProjectPrerequisites(
    projectId: string,
    requirePainters = false,
  ) {
    if (this.LEGACY_ASSIGNMENT_PROJECTS.includes(projectId)) return;

    const health = await this.getHealth(projectId);
    const missing: string[] = [];
    if (Number(health.layer_rows) === 0) missing.push('indr.layer');
    if (Number(health.surface_rows) === 0) missing.push('indr.surface_number (Dimensions)');
    if (Number(health.productivity_rows) === 0) missing.push('indr.productivity_master');
    if (requirePainters && Number(health.painter_rows) === 0) {
      missing.push('indr.all_site_painter_master (assignment_v_reporting_painters mapping)');
    }

    if (missing.length) {
      throw new BadRequestException(
        `Assignment setup is incomplete for ${projectId}. Missing project data: ${missing.join(', ')}`,
      );
    }
  }

  private async getProjectSiteName(projectId: string): Promise<string> {
    // Exact legacy site strings are intentionally preserved because the SQL
    // capacity function and existing painter_availability logic depend on them.
    if (projectId === 'indradhanush') return 'Indradhanush';
    if (projectId === 'park_heights') return 'Park Heights';

    // For a new project, reuse the project-linked painter master site label
    // when available, then the human-readable project master name.
    // The underlying capacity function remains unchanged.
    const rows = await this.prisma.$queryRaw<Array<{ site_name: string }>>`
      select coalesce(
        (select nullif(trim(p.current_site), '')
         from indr.assignment_v_reporting_painters p
         where p.project_id = ${projectId}
           and nullif(trim(coalesce(p.current_site, '')), '') is not null
         order by p.current_site
         limit 1),
        (select nullif(trim(pm.project_name), '')
         from indr.project_master pm
         where pm.project_id = ${projectId}
         limit 1),
        ${projectId}
      ) as site_name
    `;
    return rows[0]?.site_name || projectId;
  }

  private getJibbleLocationName(projectId: string) {
    const locationName = this.JIBBLE_LOCATION_BY_PROJECT[projectId];

    if (!locationName) {
      throw new BadRequestException(
        `Jibble location is not configured for project: ${projectId}`,
      );
    }

    return locationName;
  }

  private normalizeRows<T = any>(rows: any[]): T[] {
    return rows.map((row) => this.normalizeRow(row));
  }

  private async applyLongSqlTimeout(tx: any) {
    await tx.$executeRawUnsafe("set local statement_timeout = '180s'");
    await tx.$executeRawUnsafe(
      "set local idle_in_transaction_session_timeout = '180s'",
    );
  }

  /**
   * Serialize writes that modify the same recommendation run.
   *
   * The UI can legitimately issue reads while a mutation is in progress and a
   * second user/backend instance can also touch the same run. A transaction-level
   * advisory lock prevents Generate/Add/Remove/Restore writes from interleaving
   * and producing deadlocks or temporary inconsistent snapshots.
   */
  private async lockRecommendationRun(
    prisma: Pick<PrismaService, '$queryRaw'>,
    projectId: string,
    runId: string,
  ) {
    const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`
      select pg_try_advisory_xact_lock(
        hashtext(${projectId}),
        hashtext(${runId})
      ) as locked
    `;

    if (!rows[0]?.locked) {
      throw new ConflictException(
        'Recommendation generation is already running for this assignment run.',
      );
    }
  }

  /**
   * Clears only assignment-generated artifacts for the same project + assignment date.
   *
   * Why:
   * Regenerating for the same date should replace the earlier plan. If the old
   * same-day final_assignment rows remain, they can be picked up as rollover by
   * the next generated run even though they are not previous-day unfinished work.
   *
   * Safe boundary:
   * - Does NOT touch indr.backend reported work.
   * - Does NOT touch indr.layer.
   * - Does NOT touch indr.surface_number or any base/master table.
   * - Deletes only generated assignment/demand/recommendation/final-assignment
   *   artifacts whose assignment_run.assignment_date equals the selected date.
   */
  private async clearExistingAssignmentArtifactsForDate(
    projectId: string,
    assignmentDate: string,
    tx: any,
  ) {
    await tx.$executeRaw`
      delete from indr.assignment_outcome ao
      using indr.final_assignment fa
      join indr.assignment_run ar
        on ar.project_id = fa.project_id
       and ar.run_id = fa.run_id
      where ao.assignment_id = fa.assignment_id
        and fa.project_id = ${projectId}
        and ar.assignment_date = cast(${assignmentDate} as date)
    `;

    await tx.$executeRaw`
      delete from indr.final_assignment_wall faw
      using indr.final_assignment fa
      join indr.assignment_run ar
        on ar.project_id = fa.project_id
       and ar.run_id = fa.run_id
      where faw.project_id = fa.project_id
        and faw.assignment_id = fa.assignment_id
        and fa.project_id = ${projectId}
        and ar.assignment_date = cast(${assignmentDate} as date)
    `;

    await tx.$executeRaw`
      delete from indr.final_assignment fa
      using indr.assignment_run ar
      where fa.project_id = ar.project_id
        and fa.run_id = ar.run_id
        and fa.project_id = ${projectId}
        and ar.assignment_date = cast(${assignmentDate} as date)
    `;

    await tx.$executeRaw`
      delete from indr.recommended_assignment_wall raw
      using indr.recommended_assignment ra
      join indr.assignment_run ar
        on ar.project_id = ra.project_id
       and ar.run_id = ra.run_id
      where raw.project_id = ra.project_id
        and raw.recommendation_id = ra.recommendation_id
        and ra.project_id = ${projectId}
        and ar.assignment_date = cast(${assignmentDate} as date)
    `;

    await tx.$executeRaw`
      delete from indr.recommended_assignment ra
      using indr.assignment_run ar
      where ra.project_id = ar.project_id
        and ra.run_id = ar.run_id
        and ra.project_id = ${projectId}
        and ar.assignment_date = cast(${assignmentDate} as date)
    `;

    await tx.$executeRaw`
      delete from indr.work_demand_wall wdw
      using indr.work_demand_item wdi
      join indr.assignment_run ar
        on ar.project_id = wdi.project_id
       and ar.run_id = wdi.run_id
      where wdw.demand_id = wdi.demand_id
        and wdi.project_id = ${projectId}
        and ar.assignment_date = cast(${assignmentDate} as date)
    `;

    await tx.$executeRaw`
      delete from indr.work_demand_item wdi
      using indr.assignment_run ar
      where wdi.project_id = ar.project_id
        and wdi.run_id = ar.run_id
        and wdi.project_id = ${projectId}
        and ar.assignment_date = cast(${assignmentDate} as date)
    `;

    await tx.$executeRaw`
      delete from indr.assignment_run_floor_restriction floor_scope
      using indr.assignment_run ar
      where floor_scope.project_id = ar.project_id
        and floor_scope.run_id = ar.run_id
        and floor_scope.project_id = ${projectId}
        and ar.assignment_date = cast(${assignmentDate} as date)
    `;

    await tx.$executeRaw`
      delete from indr.assignment_run_layer_scope layer_scope
      using indr.assignment_run ar
      where layer_scope.project_id = ar.project_id
        and layer_scope.run_id = ar.run_id
        and layer_scope.project_id = ${projectId}
        and ar.assignment_date = cast(${assignmentDate} as date)
    `;

    await tx.$executeRaw`
      delete from indr.assignment_run_application_scope app_scope
      using indr.assignment_run ar
      where app_scope.project_id = ar.project_id
        and app_scope.run_id = ar.run_id
        and app_scope.project_id = ${projectId}
        and ar.assignment_date = cast(${assignmentDate} as date)
    `;

    await tx.$executeRaw`
      delete from indr.assignment_change_log acl
      using indr.assignment_run ar
      where acl.project_id = ar.project_id
        and acl.run_id = ar.run_id
        and acl.project_id = ${projectId}
        and ar.assignment_date = cast(${assignmentDate} as date)
    `;

    await tx.$executeRaw`
      delete from indr.assignment_run ar
      where ar.project_id = ${projectId}
        and ar.assignment_date = cast(${assignmentDate} as date)
    `;
  }



  /**
   * Scoped wkdpct refresh for the reporting layer dropdown.
   *
   * IMPORTANT:
   * - This replaces the old backend insert trigger behavior for this specific UI need.
   * - It refreshes only one application + flat, not the full 13k+ layer table.
   * - It is called only when the layer dropdown is requested with both application and flat.
   * - It does NOT touch rollover, recommendation, demand generation, final assignment,
   *   painter capacity, or assignment generation.
   */
  private async refreshLayerProgressForFlat(
    projectId: string,
    application?: string,
    flat?: string,
  ) {
    const scopedApplication = application?.trim();
    const scopedFlat = flat?.trim();

    if (!scopedApplication || !scopedFlat) {
      return;
    }

    await this.prisma.$executeRaw`
      with target_layers as (
        select
          l.project_id,
          l.layer_id,
          l.application,
          l.flat_id,
          l.flat,
          l.layer_name,
          indr.assignment_is_hour_based_layer(l.layer_name) as is_hour_based
        from indr.layer l
        where l.project_id = ${projectId}
          and indr.norm_text(l.application) = indr.norm_text(${scopedApplication})
          and (
            indr.norm_text(l.flat_id) = indr.norm_text(${scopedFlat})
            or indr.norm_text(l.flat) = indr.norm_text(${scopedFlat})
            or regexp_replace(coalesce(l.flat_id, ''), '\D', '', 'g')
               = regexp_replace(${scopedFlat}, '\D', '', 'g')
            or regexp_replace(coalesce(l.flat, ''), '\D', '', 'g')
               = regexp_replace(${scopedFlat}, '\D', '', 'g')
          )
      ),

      scoped_surface as (
        select
          tl.project_id,
          tl.layer_id,
          sum(coalesce(sn.total_area_sft, 0))::numeric as total_area
        from target_layers tl
        left join indr.surface_number sn
          on sn.project_id = tl.project_id
         and indr.norm_text(sn.application) = indr.norm_text(tl.application)
         and (
           indr.norm_text(sn.base) = indr.norm_text(tl.flat_id)
           or indr.norm_text(sn.base) = indr.norm_text(tl.flat)
           or regexp_replace(coalesce(sn.base, ''), '\D', '', 'g')
              = regexp_replace(coalesce(tl.flat_id, tl.flat, ''), '\D', '', 'g')
         )
        group by tl.project_id, tl.layer_id
      ),

      scoped_backend as (
        select
          b.project_id,
          b.application,
          b.flat,
          b.layer_id,
          b.work_layer,
          b.painter_names,
          coalesce(b.area, 0)::numeric as area,
          coalesce(b.working_hours, 0)::numeric as working_hours
        from indr.backend b
        where b.project_id = ${projectId}
          and b.work_status in ('Done', 'DONE', 'done')
          and indr.norm_text(b.application) = indr.norm_text(${scopedApplication})
          and (
            indr.norm_text(b.flat) = indr.norm_text(${scopedFlat})
            or regexp_replace(coalesce(b.flat, ''), '\D', '', 'g')
               = regexp_replace(${scopedFlat}, '\D', '', 'g')
          )
      ),

      reported as (
        select
          tl.project_id,
          tl.layer_id,
          sum(
            case
              when tl.is_hour_based then 0
              else coalesce(b.area, 0)
            end
          )::numeric as done_area,
          sum(
            case
              when tl.is_hour_based then
                coalesce(b.working_hours, 0)
                * greatest(
                    coalesce(
                      cardinality(
                        regexp_split_to_array(
                          nullif(trim(coalesce(b.painter_names, '')), ''),
                          '\\s*,\\s*'
                        )
                      ),
                      1
                    ),
                    1
                  )
              else 0
            end
          )::numeric as reported_hours
        from target_layers tl
        left join scoped_backend b
          on b.project_id = tl.project_id
         and (
           b.layer_id = tl.layer_id
           or (
             b.application = tl.application
             and (b.flat = tl.flat_id or b.flat = tl.flat)
             and b.work_layer = tl.layer_name
           )
           or (
             indr.norm_text(coalesce(b.layer_id, '')) = indr.norm_text(coalesce(tl.layer_id, ''))
             or indr.norm_text(coalesce(b.work_layer, '')) = indr.norm_text(tl.layer_name)
           )
         )
        group by tl.project_id, tl.layer_id
      ),

      calculated as (
        select
          tl.project_id,
          tl.layer_id,
          case
            when tl.is_hour_based then
              least(
                round((coalesce(r.reported_hours, 0) / 24 * 100)::numeric, 2),
                100
              )
            when coalesce(ss.total_area, 0) > 0 then
              least(
                round((coalesce(r.done_area, 0) / ss.total_area * 100)::numeric, 2),
                100
              )
            else 0
          end as new_wkdpct
        from target_layers tl
        left join scoped_surface ss
          on ss.project_id = tl.project_id
         and ss.layer_id = tl.layer_id
        left join reported r
          on r.project_id = tl.project_id
         and r.layer_id = tl.layer_id
      )

      update indr.layer l
      set
        wkdpct = calculated.new_wkdpct,
        updated_at = now()
      from calculated
      where l.project_id = calculated.project_id
        and l.layer_id = calculated.layer_id
        and l.wkdpct is distinct from calculated.new_wkdpct
    `;
  }

  /**
   * Keep indr.layer.wkdpct in sync for true 24-hour labour-based layers.
   * The source view already calculates labour-hours as working_hours * painter count.
   * Area-based layers (including Touchup Putty/Sanding) are not present in that view,
   * so this update cannot change their wkdpct.
   */
  private async syncStoredHourBasedWkdpct(
    projectId: string,
    layerIds: Array<string | null | undefined>,
  ) {
    const uniqueLayerIds = Array.from(
      new Set(
        layerIds
          .map((layerId) => String(layerId ?? '').trim())
          .filter(Boolean),
      ),
    );

    if (!uniqueLayerIds.length) {
      return;
    }

    await this.prisma.$executeRaw`
      update indr.layer l
      set
        wkdpct = coalesce(h.wkdpct, 0),
        updated_at = now()
      from indr.assignment_v_hour_layer_status h
      where l.project_id = ${projectId}
        and l.layer_id = h.layer_id
        and l.layer_id = any(${uniqueLayerIds}::text[])
        and indr.assignment_is_hour_based_layer(l.layer_name)
        and l.wkdpct is distinct from coalesce(h.wkdpct, 0)
    `;
  }

  private async getLatestSnapshotDemandRows(
    projectId: string,
    sectionNames: string[] = [],
  ) {
    this.assertAssignmentProject(projectId);

    // IMPORTANT PERFORMANCE NOTE:
    // Tomorrow Work Demand needs grouped demand rows, not one row per wall.
    // Returning work_demand_item rows directly avoids exploding APH data into
    // thousands of wall rows on every page load. Detailed walls are still
    // loaded only in Recommended Workspace through getDemandWalls().
    const rows = await this.prisma.$queryRaw<any[]>`
      with latest_run as (
        select ar.run_id
        from indr.assignment_run ar
        where ar.project_id = ${projectId}
        order by ar.assignment_date desc, ar.generated_at desc
        limit 1
      ),

      rollover_blocked_flats as (
        select distinct
          wdi.project_id,
          wdi.run_id,
          indr.norm_text(wdi.application) as application_key,
          indr.norm_text(wdi.flat) as flat_key
        from latest_run lr
        join indr.work_demand_item wdi
          on wdi.project_id = ${projectId}
         and wdi.run_id = lr.run_id
        where indr.norm_text(coalesce(wdi.section, '')) = 'ROLLOVER'
          and coalesce(wdi.remaining_area, 0) > 0
          and not indr.assignment_is_helper_work_layer(wdi.layer_name)
      ),

      ongoing_blocked_flats as (
        select distinct
          wdi.project_id, wdi.run_id,
          indr.norm_text(wdi.application) as application_key,
          indr.norm_text(wdi.flat) as flat_key
        from latest_run lr
        join indr.work_demand_item wdi
          on wdi.project_id = ${projectId}
         and wdi.run_id = lr.run_id
        where indr.norm_text(coalesce(wdi.section, '')) = 'ONGOING'
          and coalesce(wdi.remaining_area, 0) > 0
          and not indr.assignment_is_helper_work_layer(wdi.layer_name)
      ),

      active_recommended as (
        select
          ra.project_id,
          ra.run_id,
          ra.demand_id,
          sum(coalesce(ra.assigned_area, 0))::numeric as assigned_area,
          sum(coalesce(ra.required_hours, 0))::numeric as assigned_hours
        from latest_run lr
        join indr.recommended_assignment ra
          on ra.project_id = ${projectId}
         and ra.run_id = lr.run_id
        where indr.norm_text(coalesce(ra.recommendation_status, 'Draft')) not in (
          'REMOVED',
          'CANCELLED'
        )
        group by
          ra.project_id,
          ra.run_id,
          ra.demand_id
      )

      select
        wdi.project_id,
        wdi.source_id,
        null::text as source_wall_id,
        wdi.section,
        wdi.priority_rank,
        wdi.source_table,
        wdi.block,
        wdi.application,
        wdi.flat,
        wdi.layer_id,
        wdi.layer_name,
        wdi.surface_type,
        wdi.layer_order,
        wdi.billable,
        null::text as wall_name,
        coalesce(wdi.total_area, wdi.remaining_area, 0)::numeric as wall_area,
        coalesce(wdi.wall_count, 0)::int as wall_count,
        coalesce(wdi.wall_names, '')::text as wall_names,
        greatest(
          coalesce(wdi.remaining_area, 0) - coalesce(active_rec.assigned_area, 0),
          0
        )::numeric as remaining_area,
        wdi.machine_or_manual,
        wdi.productivity_mode_rule,
        coalesce(wdi.productivity_per_hour, 0)::numeric as productivity_per_hour,
        greatest(
          coalesce(wdi.required_hours, 0) - coalesce(active_rec.assigned_hours, 0),
          0
        )::numeric as required_hours,
        wdi.oldest_date,
        wdi.eligibility_status,
        wdi.risk_reason,
        wdi.demand_id,
        wdi.run_id,
        wdi.created_at,
        coalesce(wdi.is_hour_based, indr.assignment_is_hour_based_layer(wdi.layer_name))::boolean as is_hour_based,
        coalesce(wdi.total_hours, 0)::numeric as total_hours,
        coalesce(wdi.reported_hours, 0)::numeric as reported_hours,
        greatest(
          coalesce(wdi.remaining_hours, wdi.required_hours, wdi.remaining_area, 0)
          - coalesce(active_rec.assigned_hours, active_rec.assigned_area, 0),
          0
        )::numeric as remaining_hours
      from latest_run lr
      join indr.work_demand_item wdi
        on wdi.project_id = ${projectId}
       and wdi.run_id = lr.run_id
      left join active_recommended active_rec
        on active_rec.project_id = wdi.project_id
       and active_rec.run_id = wdi.run_id
       and active_rec.demand_id = wdi.demand_id
      where wdi.project_id = ${projectId}
        and (
          cardinality(${sectionNames}::text[]) = 0
          or exists (
            select 1
            from unnest(${sectionNames}::text[]) as selected_section(section_name)
            where indr.norm_text(selected_section.section_name) = indr.norm_text(wdi.section)
          )
        )
        and not exists (
          select 1
          from rollover_blocked_flats rb
          where rb.project_id = wdi.project_id
            and rb.run_id = wdi.run_id
            and rb.application_key = indr.norm_text(wdi.application)
            and rb.flat_key = indr.norm_text(wdi.flat)
            and indr.norm_text(coalesce(wdi.section, '')) in (
              'NEXT LAYER READY', 'NEW LAYER', 'FRESH FLATS'
            )
            and not indr.assignment_is_helper_work_layer(wdi.layer_name)
        )
        and not exists (
          select 1
          from ongoing_blocked_flats ob
          where ob.project_id = wdi.project_id
            and ob.run_id = wdi.run_id
            and ob.application_key = indr.norm_text(wdi.application)
            and ob.flat_key = indr.norm_text(wdi.flat)
            and indr.norm_text(coalesce(wdi.section, '')) in (
              'NEXT LAYER READY', 'NEW LAYER', 'FRESH FLATS'
            )
            and not indr.assignment_is_helper_work_layer(wdi.layer_name)
        )
        and (
          (
            coalesce(wdi.is_hour_based, indr.assignment_is_hour_based_layer(wdi.layer_name)) = true
            and greatest(
              coalesce(wdi.remaining_hours, wdi.required_hours, wdi.remaining_area, 0)
              - coalesce(active_rec.assigned_hours, active_rec.assigned_area, 0),
              0
            ) > 0.009
          )
          or
          (
            coalesce(wdi.is_hour_based, false) = false
            and greatest(
              coalesce(wdi.remaining_area, 0) - coalesce(active_rec.assigned_area, 0),
              0
            ) > 0.009
            and (
              greatest(
                coalesce(wdi.required_hours, 0) - coalesce(active_rec.assigned_hours, 0),
                0
              ) > 0.009
              or indr.norm_text(coalesce(wdi.section, '')) = 'ONGOING'
            )
          )
        )
      order by
        wdi.priority_rank,
        wdi.application,
        case
          when regexp_replace(coalesce(wdi.flat, ''), '\D', '', 'g') ~ '^[0-9]+$'
          then regexp_replace(coalesce(wdi.flat, ''), '\D', '', 'g')::numeric
          else 999999
        end,
        wdi.flat,
        wdi.layer_order,
        wdi.layer_name,
        case
          when indr.norm_text(coalesce(wdi.surface_type, '')) = 'CEILING' then 1
          when indr.norm_text(coalesce(wdi.surface_type, '')) = 'WALL' then 2
          else 3
        end
    `;

    return this.normalizeRows(rows);
  }

  private async latestRunHasDemandSnapshot(projectId: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<Array<{ has_snapshot: boolean }>>`
    with latest_run as (
      select ar.run_id
      from indr.assignment_run ar
      where ar.project_id = ${projectId}
      order by ar.assignment_date desc, ar.generated_at desc
      limit 1
    )

    select exists (
      select 1
      from latest_run lr
      join indr.work_demand_item wdi
        on wdi.project_id = ${projectId}
       and wdi.run_id = lr.run_id
      limit 1
    )::boolean as has_snapshot
    `;

    return rows[0]?.has_snapshot === true;
  }

  private async shouldUseSnapshotDemand(projectId: string) {
    // Newly registered projects follow the existing Park Heights snapshot
    // workflow. Indradhanush keeps its legacy fallback behavior.
    if (projectId !== 'indradhanush') {
      return true;
    }

    return this.latestRunHasDemandSnapshot(projectId);
  }

  private async initializeRecommendationScope(
    projectId: string,
    runId: string,
    tx?: any,
  ) {
    const db = tx ?? this.prisma;

    await db.$executeRaw`
      select indr.assignment_initialize_recommendation_scope(
        ${projectId},
        cast(${runId} as uuid)
      )
    `;
  }

  private async ensureRecommendationScopeExists(
    projectId: string,
    runId: string,
    tx?: any,
  ) {
    const db = tx ?? this.prisma;

    const rows = await db.$queryRaw<Array<{ has_scope: boolean }>>`
      select exists (
        select 1
        from indr.assignment_run_application_scope app_scope
        where app_scope.project_id = ${projectId}
          and app_scope.run_id = cast(${runId} as uuid)
        limit 1
      )::boolean as has_scope
    `;

    if (rows[0]?.has_scope === true) {
      return;
    }

    await this.initializeRecommendationScope(projectId, runId, tx);
  }


  private async syncRolloverDemandForRun(
  projectId: string,
  runId: string,
  tx?: any,
  ) {
    if (tx) {
      await tx.$executeRaw`
        select indr.assignment_sync_rollover_demand_for_run(
          ${projectId},
          cast(${runId} as uuid)
        )
      `;
      return;
    }

    await this.prisma.$transaction(
      async (trx) => {
        await this.applyLongSqlTimeout(trx);

        await trx.$executeRaw`
          select indr.assignment_sync_rollover_demand_for_run(
            ${projectId},
            cast(${runId} as uuid)
          )
        `;
      },
      this.ASSIGNMENT_LONG_TRANSACTION_OPTIONS,
    );
  }

  /**
   * Park Heights Ongoing source of truth is indr.assignment_v_ongoing.
   * Restore only the Ongoing slice into the fresh run snapshot after the normal
   * run preparation. Rollover, Next Layer Ready and hour-based helper work are
   * never deleted or rewritten here.
   */

  private async syncHourBasedDemandForRun(
  projectId: string,
  runId: string,
  tx?: any,
) {
  const db = tx ?? this.prisma;

  await db.$executeRaw`
    select indr.assignment_sync_hour_based_demand_for_run(
      ${projectId},
      cast(${runId} as uuid)
    )
  `;
  }
  private async fastReconcileRunDemand(
  projectId: string,
  runId: string,
  tx?: any,
  ) {
    const db = tx ?? this.prisma;

    await db.$executeRaw`
      select indr.assignment_fast_reconcile_run_demand(
        ${projectId},
        cast(${runId} as uuid)
      )
    `;
    await db.$executeRaw`
      select indr.assignment_prune_zero_demand_rows_for_run(
        ${projectId},
        cast(${runId} as uuid)
      )
    `;
  }

  private async pruneZeroDemandRowsForRun(
    projectId: string,
    runId: string,
    tx?: any,
  ) {
    const db = tx ?? this.prisma;

    await db.$executeRaw`
      select indr.assignment_prune_zero_demand_rows_for_run(
        ${projectId},
        cast(${runId} as uuid)
      )
    `;
  }

  private async syncMissingSequenceDemandForRun(
  projectId: string,
  runId: string,
  tx?: any,
  ) {
  const db = tx ?? this.prisma;

  await db.$executeRaw`
    select indr.assignment_sync_missing_sequence_demand_for_run(
      ${projectId},
      cast(${runId} as uuid)
    )
  `;
  }

  private async prepareRunDemand(
  projectId: string,
  runId: string,
  tx?: any,
  ) {
    const db = tx ?? this.prisma;

    await db.$executeRaw`
      select indr.assignment_prepare_run_demand(
        ${projectId},
        cast(${runId} as uuid)
      )
    `;
  }

  private async removeNonRolloverDemandBlockedByRollover(
    projectId: string,
    runId: string,
    tx?: any,
  ) {
    const db = tx ?? this.prisma;

    await db.$executeRaw`
      select indr.assignment_remove_non_rollover_blocked_by_rollover(
        ${projectId},
        cast(${runId} as uuid)
      )
    `;
  }

  private normalizeRow<T = any>(row: any): T {
    const output: any = {};

    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'bigint') {
        output[key] = Number(value);
      } else if (
        value &&
        typeof value === 'object' &&
        'toNumber' in value &&
        typeof (value as any).toNumber === 'function'
      ) {
        output[key] = (value as any).toNumber();
      } else {
        output[key] = value;
      }
    }

    return output as T;
  }

  // -------------------------------------------------------
  // Health
  // -------------------------------------------------------
  async getHealth(projectId: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      with latest_run as (
        select run_id
        from indr.assignment_run
        where project_id = ${projectId}
        order by assignment_date desc, generated_at desc
        limit 1
      )

      select
        (
          select count(*)
          from indr.backend
          where project_id = ${projectId}
        ) as backend_rows,

        (
          select count(*)
          from indr.layer
          where project_id = ${projectId}
        ) as layer_rows,

        (
          select count(*)
          from indr.surface_number
          where project_id = ${projectId}
        ) as surface_rows,

        (
          select count(*)
          from indr.productivity_master
          where project_id = ${projectId}
        ) as productivity_rows,

        (
          select count(*)
          from indr.assignment_v_reporting_painters
          where project_id = ${projectId}
        ) as painter_rows,

        (
          select count(*)
          from indr.work_demand_item wdi
          join latest_run lr
            on lr.run_id = wdi.run_id
          where wdi.project_id = ${projectId}
        ) as live_demand_rows,

        (
          select count(*)
          from indr.assignment_run
          where project_id = ${projectId}
        ) as assignment_run_rows,

        (
          select count(*)
          from indr.work_demand_item
          where project_id = ${projectId}
        ) as work_demand_item_rows,

        (
          select count(*)
          from indr.work_demand_wall
          where project_id = ${projectId}
        ) as work_demand_wall_rows
    `;

    return this.normalizeRow(rows[0]);
  }

  async getBlocks(projectId: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_v_reporting_blocks
      where project_id = ${projectId}
      order by block
    `;

    return this.normalizeRows(rows);
  }
  async getApplications(projectId: string, block?: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_v_reporting_applications
      where project_id = ${projectId}
        and (${block ?? null}::text is null or indr.norm_text(block) = indr.norm_text(${block ?? null}))
      order by block, application
    `;

    return this.normalizeRows(rows);
  }
  async getFlats(projectId: string, block?: string, application?: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_v_reporting_flats
      where project_id = ${projectId}
        and (${block ?? null}::text is null or indr.norm_text(block) = indr.norm_text(${block ?? null}))
        and (${application ?? null}::text is null or indr.norm_text(application) = indr.norm_text(${application ?? null}))
      order by block, application, flat
    `;

    return this.normalizeRows(rows);
  }
  async getLayers(projectId: string, application?: string, flat?: string) {
    this.assertAssignmentProject(projectId);

    // When reporting from the Unassigned Work form, the layer dropdown is the
    // first place where the user needs fresh wkdpct after Assigned Work bulk
    // reporting. Refresh only the selected application + flat here.
    // Do not re-enable the old backend trigger; that made reporting inserts slow.
    await this.refreshLayerProgressForFlat(projectId, application, flat);

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_v_reporting_layers
      where project_id = ${projectId}
        and (${application ?? null}::text is null or indr.norm_text(application) = indr.norm_text(${application ?? null}))
        and (${flat ?? null}::text is null or indr.norm_text(flat) = indr.norm_text(${flat ?? null}))
      order by block, application, flat, layer_order, layer_name
    `;

    return this.normalizeRows(rows);
  }

  async getWalls(
    projectId: string,
    application?: string,
    flat?: string,
    layerId?: string,
  ) {
    this.assertAssignmentProject(projectId);

    // Fast scoped path used by both Assigned Work and Unassigned Work reporting.
    // Both flows already send application + flat + layerId, so there is no
    // reason to build assignment_v_backend_done_wall for the whole project.
    //
    // The scoped function preserves the existing reporting rule:
    // a wall already reported as Done for this exact flat + layer is excluded.
    if (application && flat && layerId) {
      const rows = await this.prisma.$queryRaw<any[]>`
        select *
        from indr.assignment_get_reporting_walls_scoped(
          ${projectId},
          ${application},
          ${flat},
          ${layerId}
        )
        order by layer_order, wall_name
      `;

      return this.normalizeRows(rows);
    }

    // Keep the previous view as a fallback for any existing caller that does
    // not provide the complete reporting scope. This avoids changing other
    // Assignment Engine behaviour.
    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_v_reporting_wall_dropdown
      where project_id = ${projectId}
        and (${application ?? null}::text is null or indr.norm_text(application) = indr.norm_text(${application ?? null}))
        and (${flat ?? null}::text is null or indr.norm_text(flat) = indr.norm_text(${flat ?? null}))
        and (${layerId ?? null}::text is null or indr.norm_text(layer_id) = indr.norm_text(${layerId ?? null}))
      order by block, application, flat, layer_order, wall_name
    `;

    return this.normalizeRows(rows);
  }
  async getPainters(projectId: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select
        project_id,
        painter_id,
        row_id,
        painter_name,
        coalesce(
          painter_display,
          trim(
            coalesce(painter_name, '')
            ||
            case
              when coalesce(painter_id, '') <> ''
              then '(' || painter_id || ')'
              else ''
            end
          )
        ) as painter_display,
        current_site,
        category,
        daily_wage,
        status,
        created_at,
        updated_at
      from indr.assignment_v_reporting_painters
      where project_id = ${projectId}
      order by painter_name
    `;

    return this.normalizeRows(rows);
  }
  async getProductivityOptions(
    projectId: string,
    application?: string,
    layerName?: string,
  ) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_v_productivity_options
      where project_id = ${projectId}
        and (${application ?? null}::text is null or indr.norm_text(application) = indr.norm_text(${application ?? null}))
        and (${layerName ?? null}::text is null or indr.norm_text(layer_name) = indr.norm_text(${layerName ?? null}))
      order by application, layer_name, machine_or_manual
    `;

    return this.normalizeRows(rows);
  }
  async getLayerStatus(projectId: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_v_layer_status
      where project_id = ${projectId}
      order by application, flat, layer_order
    `;

    return this.normalizeRows(rows);
  }
  async getMaterialSuggestion(
    projectId: string,
    application?: string,
    layerName?: string,
  ) {
    this.assertAssignmentProject(projectId);

    if (!application || !layerName) {
      return null;
    }

    const rows = await this.prisma.$queryRaw<any[]>`
      select
        material_id,
        project_id,
        application,
        layer_name,
        material_name,
        coverage,
        unit_cost,
        material_per_sqft
      from indr.assignment_v_reporting_material_options
      where project_id = ${projectId}
        and indr.norm_text(application) = indr.norm_text(${application})
        and indr.norm_text(layer_name) = indr.norm_text(${layerName})
      order by updated_at desc
      limit 1
    `;

    return rows.length ? this.normalizeRow(rows[0]) : null;
  }
    async getRollover(projectId: string, assignmentDate?: string) {
    this.assertAssignmentProject(projectId);

    if (assignmentDate) {
      const runRows = await this.prisma.$queryRaw<Array<{ run_id: string }>>`
        select run_id
        from indr.assignment_run
        where project_id = ${projectId}
          and assignment_date = cast(${assignmentDate} as date)
        order by generated_at desc
        limit 1
      `;

      const runId = runRows[0]?.run_id;

      if (runId) {
         const rows = await this.prisma.$queryRaw<any[]>`
          with active_recommended as (
            select
              ra.project_id,
              ra.run_id,
              ra.demand_id,
              sum(coalesce(ra.assigned_area, 0))::numeric as assigned_area,
              sum(coalesce(ra.required_hours, 0))::numeric as assigned_hours
            from indr.recommended_assignment ra
            where ra.project_id = ${projectId}
              and ra.run_id = cast(${runId} as uuid)
              and indr.norm_text(coalesce(ra.recommendation_status, 'Draft')) not in (
                'REMOVED',
                'CANCELLED'
              )
            group by
              ra.project_id,
              ra.run_id,
              ra.demand_id
          )

          select
            wdi.project_id,
            wdi.source_id,
            null::text as source_wall_id,
            wdi.section,
            wdi.priority_rank,
            wdi.source_table,
            wdi.block,
            wdi.application,
            wdi.flat,
            wdi.layer_id,
            wdi.layer_name,
            wdi.surface_type,
            wdi.layer_order,
            wdi.billable,
            null::text as wall_name,
            coalesce(wdi.total_area, wdi.remaining_area, 0)::numeric as wall_area,
            coalesce(wdi.wall_count, 0)::int as wall_count,
            coalesce(wdi.wall_names, '')::text as wall_names,
            greatest(
              coalesce(wdi.remaining_area, 0) - coalesce(active_rec.assigned_area, 0),
              0
            )::numeric as remaining_area,
            wdi.machine_or_manual,
            wdi.productivity_mode_rule,
            coalesce(wdi.productivity_per_hour, 0)::numeric as productivity_per_hour,
            greatest(
              coalesce(wdi.required_hours, 0) - coalesce(active_rec.assigned_hours, 0),
              0
            )::numeric as required_hours,
            wdi.oldest_date,
            wdi.eligibility_status,
            wdi.risk_reason,
            wdi.demand_id,
            wdi.run_id,
            wdi.created_at,
            coalesce(wdi.is_hour_based, false)::boolean as is_hour_based,
            coalesce(wdi.total_hours, 0)::numeric as total_hours,
            coalesce(wdi.reported_hours, 0)::numeric as reported_hours,
            greatest(
              coalesce(wdi.remaining_hours, wdi.required_hours, wdi.remaining_area, 0)
              - coalesce(active_rec.assigned_hours, active_rec.assigned_area, 0),
              0
            )::numeric as remaining_hours
          from indr.work_demand_item wdi
          left join active_recommended active_rec
            on active_rec.project_id = wdi.project_id
           and active_rec.run_id = wdi.run_id
           and active_rec.demand_id = wdi.demand_id
          where wdi.project_id = ${projectId}
            and wdi.run_id = cast(${runId} as uuid)
            and indr.norm_text(coalesce(wdi.section, '')) = 'ROLLOVER'
            and greatest(
              coalesce(wdi.remaining_area, 0) - coalesce(active_rec.assigned_area, 0),
              0
            ) > 0.009
            and greatest(
              coalesce(wdi.required_hours, 0) - coalesce(active_rec.assigned_hours, 0),
              0
            ) > 0.009
          order by
            wdi.priority_rank,
            wdi.application,
            case
              when regexp_replace(coalesce(wdi.flat, ''), '\\D', '', 'g') ~ '^[0-9]+$'
              then regexp_replace(coalesce(wdi.flat, ''), '\\D', '', 'g')::numeric
              else 999999
            end,
            wdi.flat,
            wdi.layer_order,
            wdi.layer_name,
            case
              when indr.norm_text(coalesce(wdi.surface_type, '')) = 'CEILING' then 1
              when indr.norm_text(coalesce(wdi.surface_type, '')) = 'WALL' then 2
              else 3
            end
        `;

        return this.normalizeRows(rows);
      }
    }

  const rows = await this.prisma.$queryRaw<any[]>`
    select *
    from indr.assignment_v_rollover
    where project_id = ${projectId}
    order by priority_rank, application, flat, layer_order, layer_name, wall_name
  `;

  return this.normalizeRows(rows);
}

  async getQcRework(projectId: string) {
    this.assertAssignmentProject(projectId);

    if (await this.shouldUseSnapshotDemand(projectId)) {
      return this.getLatestSnapshotDemandRows(projectId, ['QC Rework']);
    }

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_v_qc_rework
      where project_id = ${projectId}
      order by priority_rank, application, flat, layer_order, layer_name, wall_name
    `;

    return this.normalizeRows(rows);
  }

  async getOngoing(projectId: string) {
    this.assertAssignmentProject(projectId);

    // Park Heights must use the prepared run snapshot here. Querying the full
    // wall-level assignment_v_ongoing view for the whole project is too
    // expensive once backend history is populated and causes 57014 timeouts.
    if (await this.shouldUseSnapshotDemand(projectId)) {
      return this.getLatestSnapshotDemandRows(projectId, ['Ongoing']);
    }

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_v_ongoing
      where project_id = ${projectId}
      order by priority_rank, application, flat, layer_order, layer_name, wall_name
    `;

    return this.normalizeRows(rows);
  }

  async getNewLayer(projectId: string) {
    this.assertAssignmentProject(projectId);

    if (await this.shouldUseSnapshotDemand(projectId)) {
      return this.getLatestSnapshotDemandRows(projectId, [
        'Next Layer Ready',
        'New Layer',
        'Fresh Flats',
      ]);
    }

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_v_new_layer_display
      where project_id = ${projectId}
      order by priority_rank, application, flat, layer_order, layer_name, wall_name
    `;

    return this.normalizeRows(rows);
  }

  async getLiveDemand(projectId: string) {
    this.assertAssignmentProject(projectId);

    if (await this.shouldUseSnapshotDemand(projectId)) {
      return this.getLatestSnapshotDemandRows(projectId);
    }

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_v_tomorrow_work_demand
      where project_id = ${projectId}
      order by priority_rank, application, flat, layer_order, layer_name, surface_type, wall_name
    `;

    return this.normalizeRows(rows);
  }
  async createAssignmentRun(projectId: string, dto: CreateAssignmentRunDto) {
    this.assertAssignmentProject(projectId);
    // Check BEFORE deleting/replacing any existing same-day run artifacts.
    await this.assertNewProjectPrerequisites(projectId);

    const siteName = await this.getProjectSiteName(projectId);
    const generatedBy = dto.generatedBy ?? 'system';

    const runId = await this.prisma.$transaction(
      async (tx) => {
        await this.applyLongSqlTimeout(tx);

        // Regeneration for the same date must replace the previous generated
        // plan. Otherwise same-date published rows can be read as rollover by
        // the next run. This cleanup only removes assignment-generated artifacts
        // for this project/date; it does not touch backend/layer/surface data.
        await this.clearExistingAssignmentArtifactsForDate(
          projectId,
          dto.assignmentDate,
          tx,
        );

        const rows =
          projectId === 'indradhanush'
            ? await tx.$queryRaw<Array<{ run_id: string }>>`
                select indr.assignment_clone_latest_demand_snapshot(
                  cast(${dto.assignmentDate} as date),
                  ${projectId},
                  ${siteName},
                  ${generatedBy}
                ) as run_id
              `
            : await tx.$queryRaw<Array<{ run_id: string }>>`
                select indr.assignment_create_run_and_demand(
                  cast(${dto.assignmentDate} as date),
                  ${projectId},
                  ${siteName},
                  ${generatedBy}
                ) as run_id
              `;

        const createdRunId = rows[0]?.run_id ?? '';

        if (createdRunId) {
          // The normal demand preparation already builds the run snapshot.
          // Do not rescan the full live Ongoing wall view inside this 180s
          // transaction; that was the source of the P2028 expiry.
          await this.prepareRunDemand(projectId, createdRunId, tx);
        }

        return createdRunId;
      },
      this.ASSIGNMENT_LONG_TRANSACTION_OPTIONS,
    );

    if (!runId) {
      throw new BadRequestException('Assignment run was not created');
    }

    const [run, demandItems] = await Promise.all([
      this.getAssignmentRunById(projectId, runId),
      this.getDemandItems(projectId, runId),
    ]);

    return {
      runId,
      run,
      demandItems,
      demandWalls: [],
    };
  }

  async getAssignmentRuns(projectId: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_run
      where project_id = ${projectId}
      order by assignment_date desc, generated_at desc
    `;

    return this.normalizeRows(rows);
  }
  async getAssignmentRunById(projectId: string, runId: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_run
      where project_id = ${projectId}
        and run_id = cast(${runId} as uuid)
      limit 1
    `;

    if (!rows.length) {
      throw new NotFoundException('Assignment run not found');
    }

    return this.normalizeRow(rows[0]);
  }
  async getDemandItems(projectId: string, runId: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      with rollover_blocked_flats as (
        select distinct
          wdi.project_id,
          wdi.run_id,
          indr.norm_text(wdi.application) as application_key,
          indr.norm_text(wdi.flat) as flat_key
        from indr.work_demand_item wdi
        where wdi.project_id = ${projectId}
          and wdi.run_id = cast(${runId} as uuid)
          and indr.norm_text(coalesce(wdi.section, '')) = 'ROLLOVER'
          and coalesce(wdi.remaining_area, 0) > 0
          and not indr.assignment_is_helper_work_layer(wdi.layer_name)
      ),

      ongoing_blocked_flats as (
        select distinct
          wdi.project_id, wdi.run_id,
          indr.norm_text(wdi.application) as application_key,
          indr.norm_text(wdi.flat) as flat_key
        from indr.work_demand_item wdi
        where wdi.project_id = ${projectId}
          and wdi.run_id = cast(${runId} as uuid)
          and indr.norm_text(coalesce(wdi.section, '')) = 'ONGOING'
          and coalesce(wdi.remaining_area, 0) > 0
          and not indr.assignment_is_helper_work_layer(wdi.layer_name)
      ),

      active_recommended as (
        select
          ra.project_id,
          ra.run_id,
          ra.demand_id,
          sum(coalesce(ra.assigned_area, 0))::numeric as assigned_area,
          sum(coalesce(ra.required_hours, 0))::numeric as assigned_hours
        from indr.recommended_assignment ra
        where ra.project_id = ${projectId}
          and ra.run_id = cast(${runId} as uuid)
          and indr.norm_text(coalesce(ra.recommendation_status, 'Draft')) not in (
            'REMOVED',
            'CANCELLED'
          )
        group by
          ra.project_id,
          ra.run_id,
          ra.demand_id
      )

      select wdi.*
      from indr.work_demand_item wdi
      left join active_recommended active_rec
        on active_rec.project_id = wdi.project_id
       and active_rec.run_id = wdi.run_id
       and active_rec.demand_id = wdi.demand_id
      where wdi.project_id = ${projectId}
        and wdi.run_id = cast(${runId} as uuid)
        and (
          (
            coalesce(wdi.is_hour_based, false) = true
            and greatest(
              coalesce(wdi.remaining_hours, wdi.required_hours, wdi.remaining_area, 0)
              - coalesce(active_rec.assigned_hours, active_rec.assigned_area, 0),
              0
            ) > 0.009
          )
          or
          (
            coalesce(wdi.is_hour_based, false) = false
            and greatest(
              coalesce(wdi.remaining_area, 0) - coalesce(active_rec.assigned_area, 0),
              0
            ) > 0.009
            and (
              greatest(
                coalesce(wdi.required_hours, 0) - coalesce(active_rec.assigned_hours, 0),
                0
              ) > 0.009
              or indr.norm_text(coalesce(wdi.section, '')) = 'ONGOING'
            )
          )
        )
        and not exists (
          select 1
          from rollover_blocked_flats rb
          where rb.project_id = wdi.project_id
            and rb.run_id = wdi.run_id
            and rb.application_key = indr.norm_text(wdi.application)
            and rb.flat_key = indr.norm_text(wdi.flat)
            and indr.norm_text(coalesce(wdi.section, '')) in (
              'NEXT LAYER READY', 'NEW LAYER', 'FRESH FLATS'
            )
            and not indr.assignment_is_helper_work_layer(wdi.layer_name)
        )
        and not exists (
          select 1
          from ongoing_blocked_flats ob
          where ob.project_id = wdi.project_id
            and ob.run_id = wdi.run_id
            and ob.application_key = indr.norm_text(wdi.application)
            and ob.flat_key = indr.norm_text(wdi.flat)
            and indr.norm_text(coalesce(wdi.section, '')) in (
              'NEXT LAYER READY', 'NEW LAYER', 'FRESH FLATS'
            )
            and not indr.assignment_is_helper_work_layer(wdi.layer_name)
        )
      order by priority_rank, application, flat, layer_order, layer_name, surface_type
    `;

    return this.normalizeRows(rows);
  }
  async getDemandWalls(projectId: string, runId: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select
        wdw.demand_wall_id,
        wdw.project_id,
        wdw.demand_id,
        wdw.source_wall_id,
        wdw.wall_name,
        coalesce(wdw.wall_area, 0)::numeric as wall_area,
        coalesce(wdw.remaining_area, wdw.wall_area, 0)::numeric as remaining_area
      from indr.work_demand_wall wdw
      join indr.work_demand_item wdi
        on wdi.project_id = wdw.project_id
       and wdi.demand_id = wdw.demand_id
      where wdw.project_id = ${projectId}
        and wdi.run_id = cast(${runId} as uuid)
      order by
        wdi.priority_rank,
        wdi.application,
        wdi.flat,
        wdi.layer_order,
        wdi.layer_name,
        wdi.surface_type,
        wdw.wall_name
    `;

    return this.normalizeRows(rows);
  }
  async getDemandWallsForDemand(projectId: string, demandId: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select
        wdw.demand_wall_id,
        wdw.project_id,
        wdw.demand_id,
        wdw.source_wall_id,
        wdw.wall_name,
        coalesce(wdw.wall_area, 0)::numeric as wall_area,
        coalesce(wdw.remaining_area, wdw.wall_area, 0)::numeric as remaining_area
      from indr.work_demand_wall wdw
      where wdw.project_id = ${projectId}
        and wdw.demand_id = cast(${demandId} as uuid)
      order by wdw.wall_name
    `;

    return this.normalizeRows(rows);
  }

  async updateDemandWorkMode(
    projectId: string,
    demandId: string,
    machineOrManual: string,
  ) {
    this.assertAssignmentProject(projectId);

    const demandRows = await this.prisma.$queryRaw<any[]>`
      select demand_id
      from indr.work_demand_item
      where project_id = ${projectId}
        and demand_id = cast(${demandId} as uuid)
      limit 1
    `;

    if (!demandRows.length) {
      throw new NotFoundException('Demand item not found');
    }

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_update_demand_work_mode(
        cast(${demandId} as uuid),
        ${machineOrManual}
      )
    `;

    return this.normalizeRows(rows);
  }
  async getFloorRestrictions(projectId: string, runId?: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      with floor_source as (
        /*
         * surface_number is the strongest source for physical flats/floors
         * because it contains the actual project surface inventory. layer is
         * kept as a second source so the restriction UI remains complete even
         * if one source is missing a particular flat.
         */
        select
          trim(coalesce(sn.block, '')) as block,
          indr.assignment_floor_no(sn.base) as floor_no
        from indr.surface_number sn
        where sn.project_id = ${projectId}
          and coalesce(trim(sn.block), '') <> ''
          and indr.assignment_floor_no(sn.base) is not null

        union all

        select
          trim(coalesce(l.block, '')) as block,
          indr.assignment_floor_no(l.flat_id) as floor_no
        from indr.layer l
        where l.project_id = ${projectId}
          and coalesce(trim(l.block), '') <> ''
          and indr.assignment_floor_no(l.flat_id) is not null

        union all

        select
          trim(coalesce(l.block, '')) as block,
          indr.assignment_floor_no(l.flat) as floor_no
        from indr.layer l
        where l.project_id = ${projectId}
          and coalesce(trim(l.block), '') <> ''
          and indr.assignment_floor_no(l.flat) is not null
      ),

      run_scope as (
        select
          fr.block,
          fr.block_key,
          fr.blocked_floors
        from indr.assignment_run_floor_restriction fr
        where fr.project_id = ${projectId}
          and fr.run_id = cast(${runId ?? null} as uuid)
      ),

      defaults as (
        select
          fd.block,
          fd.block_key,
          fd.blocked_floors
        from indr.assignment_floor_restriction_default fd
        where fd.project_id = ${projectId}
      ),

      /*
       * Keep every block found in physical data OR already saved in a
       * restriction snapshot/default. This prevents a saved Block-G/Block-J
       * rule from disappearing just because one source temporarily has no
       * rows.
       */
      block_names as (
        select distinct trim(block) as block
        from floor_source
        where coalesce(trim(block), '') <> ''

        union

        select distinct trim(block) as block
        from run_scope
        where coalesce(trim(block), '') <> ''

        union

        select distinct trim(block) as block
        from defaults
        where coalesce(trim(block), '') <> ''
      ),

      block_options as (
        select
          bn.block,
          coalesce(
            array_agg(distinct fs.floor_no order by fs.floor_no)
              filter (where fs.floor_no is not null),
            '{}'::integer[]
          ) as available_floors
        from block_names bn
        left join floor_source fs
          on upper(trim(fs.block)) = upper(trim(bn.block))
        group by bn.block
      )

      select
        bo.block,
        bo.available_floors,
        coalesce(rs.blocked_floors, d.blocked_floors, '{}'::integer[]) as blocked_floors,
        case
          when rs.block_key is not null then 'run'
          when d.block_key is not null then 'default'
          else 'unrestricted'
        end as source
      from block_options bo
      left join run_scope rs
        on rs.block_key = upper(trim(bo.block))
      left join defaults d
        on d.block_key = upper(trim(bo.block))
      order by bo.block
    `;

    return {
      project_id: projectId,
      run_id: runId ?? null,
      blocks: this.normalizeRows(rows),
    };
  }

  private normalizeFloorRestrictions(dto?: GenerateRecommendationsDto) {
    return (dto?.floorRestrictions ?? [])
      .map((item) => ({
        block: String(item.block || '').trim(),
        blocked_floors: Array.from(
          new Set(
            (item.blockedFloors ?? [])
              .map((floor) => Number(floor))
              .filter(
                (floor) =>
                  Number.isInteger(floor) && floor >= 0 && floor <= 99,
              ),
          ),
        ).sort((a, b) => a - b),
      }))
      .filter((item) => item.block);
  }

  /**
   * Creates the run-wise floor restriction snapshot used by recommendation
   * generation. Current defaults are copied first, then any values sent by the
   * UI override them. Defaults themselves are promoted only after generation
   * succeeds, so a failed generation does not change tomorrow's settings.
   */
  private async prepareRunFloorRestrictions(
    projectId: string,
    runId: string,
    dto?: GenerateRecommendationsDto,
  ) {
    const restrictions = this.normalizeFloorRestrictions(dto);
    const payload = JSON.stringify(restrictions);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        delete from indr.assignment_run_floor_restriction
        where project_id = ${projectId}
          and run_id = cast(${runId} as uuid)
      `;

      await tx.$executeRaw`
        insert into indr.assignment_run_floor_restriction (
          project_id,
          run_id,
          block,
          blocked_floors
        )
        select
          d.project_id,
          cast(${runId} as uuid),
          d.block,
          d.blocked_floors
        from indr.assignment_floor_restriction_default d
        where d.project_id = ${projectId}
        on conflict (project_id, run_id, block_key)
        do update set
          block = excluded.block,
          blocked_floors = excluded.blocked_floors,
          updated_at = now()
      `;

      if (restrictions.length) {
        await tx.$executeRaw`
          with payload as (
            select *
            from jsonb_to_recordset(${payload}::jsonb) as x(
              block text,
              blocked_floors integer[]
            )
          )
          insert into indr.assignment_run_floor_restriction (
            project_id,
            run_id,
            block,
            blocked_floors
          )
          select
            ${projectId},
            cast(${runId} as uuid),
            trim(payload.block),
            coalesce(payload.blocked_floors, '{}'::integer[])
          from payload
          where coalesce(trim(payload.block), '') <> ''
          on conflict (project_id, run_id, block_key)
          do update set
            block = excluded.block,
            blocked_floors = excluded.blocked_floors,
            updated_at = now()
        `;
      }
    });
  }

  private async promoteRunFloorRestrictionsToDefaults(
    projectId: string,
    runId: string,
  ) {
    await this.prisma.$executeRaw`
      insert into indr.assignment_floor_restriction_default (
        project_id,
        block,
        blocked_floors
      )
      select
        fr.project_id,
        fr.block,
        fr.blocked_floors
      from indr.assignment_run_floor_restriction fr
      where fr.project_id = ${projectId}
        and fr.run_id = cast(${runId} as uuid)
      on conflict (project_id, block_key)
      do update set
        block = excluded.block,
        blocked_floors = excluded.blocked_floors,
        updated_at = now()
    `;
  }

  async getRecommendationScope(projectId: string, runId: string) {
    this.assertAssignmentProject(projectId);

    await this.getAssignmentRunById(projectId, runId);
    await this.initializeRecommendationScope(projectId, runId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select
        app_scope.project_id,
        app_scope.run_id,
        app_scope.application,
        app_scope.is_allowed,

        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'application', layer_scope.application,
              'layer_name', layer_scope.layer_name,
              'layer_order', layer_scope.layer_order,
              'is_allowed', layer_scope.is_allowed
            )
            order by
              layer_scope.layer_order,
              layer_scope.layer_name
          ) filter (where layer_scope.layer_name is not null),
          '[]'::jsonb
        ) as layers

      from indr.assignment_run_application_scope app_scope
      left join indr.assignment_run_layer_scope layer_scope
        on layer_scope.project_id = app_scope.project_id
       and layer_scope.run_id = app_scope.run_id
       and layer_scope.application_key = app_scope.application_key
      where app_scope.project_id = ${projectId}
        and app_scope.run_id = cast(${runId} as uuid)
      group by
        app_scope.project_id,
        app_scope.run_id,
        app_scope.application,
        app_scope.application_key,
        app_scope.is_allowed
      order by
        app_scope.application
    `;

    return {
      project_id: projectId,
      run_id: runId,
      applications: this.normalizeRows(rows),
    };
  }

  async updateRecommendationScope(
    projectId: string,
    runId: string,
    dto: UpdateRecommendationScopeDto,
  ) {
    this.assertAssignmentProject(projectId);

    await this.getAssignmentRunById(projectId, runId);
    await this.initializeRecommendationScope(projectId, runId);

    const applicationsPayload = JSON.stringify(dto.applications ?? []);
    const layersPayload = JSON.stringify(dto.layers ?? []);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        with payload as (
          select *
          from jsonb_to_recordset(${applicationsPayload}::jsonb)
          as x(
            application text,
            is_allowed boolean
          )
        )
        insert into indr.assignment_run_application_scope (
          project_id,
          run_id,
          application,
          is_allowed
        )
        select
          ${projectId},
          cast(${runId} as uuid),
          trim(payload.application),
          coalesce(payload.is_allowed, true)
        from payload
        where coalesce(trim(payload.application), '') <> ''
        on conflict (project_id, run_id, application_key)
        do update set
          is_allowed = excluded.is_allowed,
          updated_at = now()
      `;

      await tx.$executeRaw`
        with payload as (
          select *
          from jsonb_to_recordset(${layersPayload}::jsonb)
          as x(
            application text,
            layer_name text,
            is_allowed boolean
          )
        )
        insert into indr.assignment_run_layer_scope (
          project_id,
          run_id,
          application,
          layer_name,
          is_allowed
        )
        select
          ${projectId},
          cast(${runId} as uuid),
          trim(payload.application),
          trim(payload.layer_name),
          coalesce(payload.is_allowed, true)
        from payload
        where coalesce(trim(payload.application), '') <> ''
          and coalesce(trim(payload.layer_name), '') <> ''
        on conflict (project_id, run_id, application_key, layer_name_key)
        do update set
          is_allowed = excluded.is_allowed,
          updated_at = now()
      `;
    });

    return this.getRecommendationScope(projectId, runId);
  }

  private async applyRecommendationModeOverrides(
    projectId: string,
    runId: string,
    dto?: GenerateRecommendationsDto,
  ) {
    const overrides = (dto?.modeOverrides ?? [])
      .map((item) => ({
        application: String(item.application || '').trim(),
        layer_name: String(item.layerName || '').trim(),
        machine_or_manual: item.machineOrManual,
      }))
      .filter(
        (item) =>
          item.application &&
          item.layer_name &&
          ['Machine', 'Manual', 'Both'].includes(item.machine_or_manual),
      );

    if (!overrides.length) {
      return;
    }

    const payload = JSON.stringify(overrides);

    // One set-based update only. This keeps mode changes cheap even when the
    // same application/layer exists across many flats. Existing recommendation
    // logic then reads the recalculated mode/productivity/hours from the run
    // snapshot exactly as before.
    await this.prisma.$executeRaw`
      with mode_overrides as (
        select *
        from jsonb_to_recordset(${payload}::jsonb) as x(
          application text,
          layer_name text,
          machine_or_manual text
        )
      ),
      resolved_overrides as (
        select
          mo.application,
          mo.layer_name,
          mo.machine_or_manual,
          coalesce(
            indr.assignment_get_productivity_per_hour(
              mo.application,
              mo.layer_name,
              mo.machine_or_manual
            ),
            0
          )::numeric as productivity_per_hour
        from mode_overrides mo
      )
      update indr.work_demand_item wdi
      set
        machine_or_manual = r.machine_or_manual,
        productivity_per_hour = r.productivity_per_hour,
        required_hours = case
          when r.productivity_per_hour > 0
          then round((coalesce(wdi.remaining_area, 0) / r.productivity_per_hour)::numeric, 2)
          else 0
        end,
        productivity_mode_rule = 'User selected mode',
        eligibility_status = case
          when r.productivity_per_hour > 0 then 'Available'
          else 'Missing Productivity'
        end,
        risk_reason = case
          when r.productivity_per_hour > 0 then null
          else 'No productivity found for selected mode/application/layer'
        end
      from resolved_overrides r
      where wdi.project_id = ${projectId}
        and wdi.run_id = cast(${runId} as uuid)
        and coalesce(wdi.is_hour_based, false) = false
        and indr.norm_text(r.application) = indr.norm_text(wdi.application)
        and indr.norm_text(r.layer_name) = indr.norm_text(wdi.layer_name)
        and (
          indr.norm_text(coalesce(wdi.machine_or_manual, ''))
            is distinct from indr.norm_text(r.machine_or_manual)
          or coalesce(wdi.productivity_per_hour, 0)
            is distinct from r.productivity_per_hour
          or coalesce(wdi.required_hours, 0)
            is distinct from case
              when r.productivity_per_hour > 0
              then round(
                (coalesce(wdi.remaining_area, 0) / r.productivity_per_hour)::numeric,
                2
              )
              else 0
            end
          or indr.norm_text(coalesce(wdi.productivity_mode_rule, ''))
            is distinct from 'USER SELECTED MODE'
        )
    `;
  }

  async generateRecommendations(
    projectId: string,
    runId: string,
    dto?: GenerateRecommendationsDto,
  ) {
    this.assertAssignmentProject(projectId);
    await this.assertNewProjectPrerequisites(projectId, true);
    const siteName = await this.getProjectSiteName(projectId);

    await this.getAssignmentRunById(projectId, runId);

    const includeRollover = dto?.includeRollover !== false;

    // Apply only the user-selected application/layer work-mode decisions to
    // this run snapshot. This is intentionally separate from the global
    // productivity master/default rules and does not alter rollover creation.
    await this.applyRecommendationModeOverrides(projectId, runId, dto);

    // Create a tiny run-wise floor snapshot before recommendation selection.
    // This is set-based and does not touch demand/backend/layer data.
    await this.prepareRunFloorRestrictions(projectId, runId, dto);

    // Demand is prepared once during createAssignmentRun(). Park Heights uses
    // positive remaining-area/hour predicates in the bulk recommendation SQL
    // itself, so running the physical prune again here only rewrites the same
    // snapshot and has previously caused deadlocks/timeouts. Keep the legacy
    // prune for Indradhanush.
    if (projectId === 'indradhanush') {
      await this.pruneZeroDemandRowsForRun(projectId, runId);
    }

    await this.ensureRecommendationScopeExists(projectId, runId);

    // Use the project-scoped Park Heights bulk recommendation path for any
    // new project; leave the established Indradhanush path alone.
    if (projectId !== 'indradhanush') {
      await this.prisma.$transaction(
        async (tx) => {
          await this.applyLongSqlTimeout(tx);
          await this.lockRecommendationRun(tx, projectId, runId);

          // Park Heights/APH can create thousands of demand rows.
          // The previous frontend-side capacity cap removed excess rows one API
          // call at a time, which made Generate Plan hang. This SQL performs the
          // recommendation selection and capacity cap in one database pass.
          await tx.$executeRaw`
            delete from indr.recommended_assignment_wall raw
            using indr.recommended_assignment ra
            where raw.project_id = ra.project_id
              and raw.recommendation_id = ra.recommendation_id
              and ra.project_id = ${projectId}
              and ra.run_id = cast(${runId} as uuid)
              and coalesce(ra.is_manual_edit, false) = false
              and indr.norm_text(coalesce(ra.created_by, 'system')) = 'SYSTEM'
          `;

          await tx.$executeRaw`
            delete from indr.recommended_assignment ra
            where ra.project_id = ${projectId}
              and ra.run_id = cast(${runId} as uuid)
              and coalesce(ra.is_manual_edit, false) = false
              and indr.norm_text(coalesce(ra.created_by, 'system')) = 'SYSTEM'
          `;

          await tx.$executeRaw`
        with run_context as (
          select
            ar.project_id,
            ar.run_id,
            ar.assignment_date,
            coalesce(cap.available_hours, 0)::numeric as available_hours
          from indr.assignment_run ar
          left join lateral (
            select available_hours
            from indr.assignment_get_worker_capacity(
              ar.assignment_date,
              ar.project_id,
              ${siteName}
            )
            limit 1
          ) cap on true
          where ar.project_id = ${projectId}
            and ar.run_id = cast(${runId} as uuid)
        ),

        ongoing_presence_flats as (
          select distinct
            wdi.project_id,
            indr.norm_text(wdi.application) as application_key,
            indr.norm_text(wdi.flat) as flat_key
          from indr.work_demand_item wdi
          where wdi.project_id = ${projectId}
            and wdi.run_id = cast(${runId} as uuid)
            and indr.norm_text(coalesce(wdi.section, '')) = 'ONGOING'
            and coalesce(wdi.remaining_area, 0) > 0
            and not indr.assignment_is_helper_work_layer(wdi.layer_name)
        ),

        eligible as (
          select
            wdi.project_id,
            wdi.run_id,
            wdi.demand_id,
            wdi.block,
            wdi.application,
            wdi.flat,
            wdi.layer_id,
            wdi.layer_name,
            wdi.surface_type,
            coalesce(wdi.remaining_area, 0)::numeric as remaining_area,
            coalesce(wdi.required_hours, 0)::numeric as required_hours,
            coalesce(wdi.section, '')::text as section,
            coalesce(wdi.eligibility_status, '')::text as eligibility_status,
            wdi.machine_or_manual,
            coalesce(wdi.productivity_per_hour, 0)::numeric as productivity_per_hour,
            wdi.productivity_mode_rule,
            coalesce(wdi.billable, false)::boolean as billable,
            coalesce(wdi.layer_order, 999)::numeric as layer_order,

            case
              when regexp_replace(coalesce(wdi.flat, ''), '\\D', '', 'g') ~ '^[0-9]+$'
              then regexp_replace(coalesce(wdi.flat, ''), '\\D', '', 'g')::numeric
              else 999999
            end as flat_sort,

            case
              when indr.norm_text(coalesce(wdi.section, '')) = 'ROLLOVER' then 1
              when indr.norm_text(coalesce(wdi.section, '')) = 'ONGOING' then 2
              when indr.norm_text(coalesce(wdi.section, '')) in (
                'NEXT LAYER READY',
                'NEW LAYER',
                'FRESH FLATS'
              ) then 3
              else 99
            end as section_priority,

            case
              when indr.norm_text(coalesce(wdi.surface_type, '')) = 'CEILING' then 1
              when indr.norm_text(coalesce(wdi.surface_type, '')) = 'WALL' then 2
              else 3
            end as surface_priority

          from indr.work_demand_item wdi
          left join indr.assignment_run_application_scope app_scope
            on app_scope.project_id = wdi.project_id
           and app_scope.run_id = wdi.run_id
           and app_scope.application_key = upper(trim(coalesce(wdi.application, '')))
          left join indr.assignment_run_layer_scope layer_scope
            on layer_scope.project_id = wdi.project_id
           and layer_scope.run_id = wdi.run_id
           and layer_scope.application_key = upper(trim(coalesce(wdi.application, '')))
           and layer_scope.layer_name_key = upper(trim(coalesce(wdi.layer_name, '')))
          where wdi.project_id = ${projectId}
            and wdi.run_id = cast(${runId} as uuid)
            and not indr.assignment_is_helper_work_layer(wdi.layer_name)
            and indr.norm_text(coalesce(wdi.section, '')) <> 'QC REWORK'
            and (
              ${includeRollover}::boolean = true
              or indr.norm_text(coalesce(wdi.section, '')) <> 'ROLLOVER'
            )
            and not exists (
              select 1
              from indr.assignment_run_floor_restriction floor_scope
              where floor_scope.project_id = wdi.project_id
                and floor_scope.run_id = wdi.run_id
                and floor_scope.block_key = upper(trim(coalesce(wdi.block, '')))
                and indr.assignment_floor_no(wdi.flat) = any(floor_scope.blocked_floors)
            )
            and (
              indr.norm_text(coalesce(wdi.section, '')) in ('ROLLOVER', 'ONGOING')
              or coalesce(wdi.billable, false) = true
            )
            and (
              indr.norm_text(coalesce(wdi.section, '')) = 'ROLLOVER'
              or (
                coalesce(app_scope.is_allowed, true) = true
                and coalesce(layer_scope.is_allowed, true) = true
              )
            )
            and coalesce(wdi.remaining_area, 0) > 0
            and coalesce(wdi.required_hours, 0) > 0
        ),

        rollover_rows as (
          select *
          from eligible
          where indr.norm_text(section) = 'ROLLOVER'
        ),

        billable_rollover_flats as (
          select distinct
            project_id,
            indr.norm_text(application) as application_key,
            indr.norm_text(flat) as flat_key
          from rollover_rows
        ),

        ongoing_layer_candidates as (
          select
            x.*,
            row_number() over (
              partition by
                x.project_id,
                indr.norm_text(x.application),
                indr.norm_text(x.flat)
              order by
                x.layer_order,
                x.layer_name,
                x.layer_id
            ) as rn
          from (
            select distinct
              e.project_id,
              e.application,
              e.flat,
              e.layer_id,
              e.layer_name,
              e.layer_order,
              e.flat_sort
            from eligible e
            where indr.norm_text(e.section) = 'ONGOING'
          ) x
        ),

        selected_ongoing_layers as (
          select *
          from ongoing_layer_candidates
          where rn = 1
        ),

        selected_ongoing as (
          select e.*
          from eligible e
          join selected_ongoing_layers sol
            on sol.project_id = e.project_id
          and indr.norm_text(sol.application) = indr.norm_text(e.application)
          and indr.norm_text(sol.flat) = indr.norm_text(e.flat)
          and (
              indr.norm_text(sol.layer_id) = indr.norm_text(e.layer_id)
              or indr.norm_text(sol.layer_name) = indr.norm_text(e.layer_name)
          )
          where indr.norm_text(e.section) = 'ONGOING'
        ),

        ongoing_selected_flats as (
          select distinct
            project_id,
            indr.norm_text(application) as application_key,
            indr.norm_text(flat) as flat_key
          from selected_ongoing
        ),

        next_layer_candidates as (
          select
            x.*,
            row_number() over (
              partition by
                x.project_id,
                indr.norm_text(x.application),
                indr.norm_text(x.flat)
              order by
                x.layer_order,
                x.layer_name,
                x.layer_id
            ) as rn
          from (
            select distinct
              e.project_id,
              e.application,
              e.flat,
              e.layer_id,
              e.layer_name,
              e.layer_order,
              e.flat_sort
            from eligible e
            left join billable_rollover_flats brf
              on brf.project_id = e.project_id
            and brf.application_key = indr.norm_text(e.application)
            and brf.flat_key = indr.norm_text(e.flat)
            left join ongoing_selected_flats osf
              on osf.project_id = e.project_id
            and osf.application_key = indr.norm_text(e.application)
            and osf.flat_key = indr.norm_text(e.flat)
            left join ongoing_presence_flats opf
              on opf.project_id = e.project_id
            and opf.application_key = indr.norm_text(e.application)
            and opf.flat_key = indr.norm_text(e.flat)
            where indr.norm_text(e.section) in (
                'NEXT LAYER READY',
                'NEW LAYER',
                'FRESH FLATS'
              )
              and e.billable = true
              and brf.flat_key is null
              and osf.flat_key is null
              and opf.flat_key is null
          ) x
        ),

        selected_next_layer_layers as (
          select *
          from next_layer_candidates
          where rn = 1
        ),

        selected_next_layer as (
          select e.*
          from eligible e
          join selected_next_layer_layers snl
            on snl.project_id = e.project_id
          and indr.norm_text(snl.application) = indr.norm_text(e.application)
          and indr.norm_text(snl.flat) = indr.norm_text(e.flat)
          and (
              indr.norm_text(snl.layer_id) = indr.norm_text(e.layer_id)
              or indr.norm_text(snl.layer_name) = indr.norm_text(e.layer_name)
          )
          where indr.norm_text(e.section) in (
              'NEXT LAYER READY',
              'NEW LAYER',
              'FRESH FLATS'
            )
            and e.billable = true
        ),

        priority_selected as (
          select
            project_id,
            run_id,
            demand_id,
            block,
            application,
            flat,
            layer_id,
            layer_name,
            surface_type,
            remaining_area,
            required_hours,
            section,
            eligibility_status,
            machine_or_manual,
            productivity_per_hour,
            productivity_mode_rule,
            billable,
            layer_order,
            flat_sort,
            section_priority,
            surface_priority
          from rollover_rows

          union all

          select
            project_id,
            run_id,
            demand_id,
            block,
            application,
            flat,
            layer_id,
            layer_name,
            surface_type,
            remaining_area,
            required_hours,
            section,
            eligibility_status,
            machine_or_manual,
            productivity_per_hour,
            productivity_mode_rule,
            billable,
            layer_order,
            flat_sort,
            section_priority,
            surface_priority
          from selected_ongoing

          union all

          select
            project_id,
            run_id,
            demand_id,
            block,
            application,
            flat,
            layer_id,
            layer_name,
            surface_type,
            remaining_area,
            required_hours,
            section,
            eligibility_status,
            machine_or_manual,
            productivity_per_hour,
            productivity_mode_rule,
            billable,
            layer_order,
            flat_sort,
            section_priority,
            surface_priority
          from selected_next_layer
        ),

        deduped_priority_selected as (
          select *
          from (
            select
              ps.*,
              row_number() over (
                partition by
                  indr.norm_text(ps.section),
                  indr.norm_text(ps.application),
                  indr.norm_text(ps.flat),
                  indr.norm_text(coalesce(ps.layer_id, '')),
                  indr.norm_text(ps.layer_name),
                  indr.norm_text(coalesce(ps.surface_type, ''))
                order by
                  ps.section_priority,
                  ps.flat_sort,
                  ps.layer_order,
                  ps.surface_priority,
                  ps.demand_id
              ) as logical_rn
            from priority_selected ps
          ) ranked
          where logical_rn = 1
        ),

        ordered_priority_selected as (
          select
            ps.*,
            sum(ps.required_hours) over (
              order by
                ps.section_priority,
                ps.flat_sort,
                ps.flat,
                ps.layer_order,
                ps.surface_priority,
                ps.layer_name,
                ps.demand_id
              rows between unbounded preceding and current row
            )::numeric as cumulative_hours
          from deduped_priority_selected ps
          where coalesce(ps.required_hours, 0) > 0
        ),

        final_selected as (
          select ops.*
          from ordered_priority_selected ops
          cross join run_context rc
          where rc.available_hours <= 0
             or ops.cumulative_hours <= rc.available_hours
        ),

        inserted_recommendations as (
          insert into indr.recommended_assignment (
            project_id,
            run_id,
            demand_id,
            block,
            application,
            flat,
            layer_id,
            layer_name,
            surface_type,
            assigned_area,
            required_hours,
            assignment_type,
            recommendation_reason,
            warning_status,
            machine_or_manual,
            selected_productivity_per_hour,
            productivity_mode_rule,
            painter_count,
            recommendation_status,
            is_manual_edit,
            created_by,
            created_at
          )
          select
            fs.project_id,
            fs.run_id,
            fs.demand_id,
            fs.block,
            fs.application,
            fs.flat,
            fs.layer_id,
            fs.layer_name,
            fs.surface_type,
            fs.remaining_area,
            fs.required_hours,
            'Full',
            fs.section,
            case
              when indr.norm_text(fs.eligibility_status) = 'MISSING PRODUCTIVITY'
              then 'Missing Productivity'
              else null
            end,
            fs.machine_or_manual,
            fs.productivity_per_hour,
            fs.productivity_mode_rule,
            0,
            'Draft',
            false,
            'system',
            now()
          from final_selected fs
          where not exists (
            select 1
            from indr.recommended_assignment ra
            where ra.project_id = fs.project_id
              and ra.demand_id = fs.demand_id
              and indr.norm_text(coalesce(ra.recommendation_status, 'Draft')) not in (
                'REMOVED',
                'CANCELLED'
              )
          )
          order by
            fs.section_priority,
            fs.flat_sort,
            fs.layer_order,
            fs.surface_priority,
            fs.layer_name
          returning project_id, recommendation_id, demand_id
        ),

        all_recommendations as (
          select
            ir.project_id,
            ir.recommendation_id,
            ir.demand_id
          from inserted_recommendations ir

          union

          select
            ra.project_id,
            ra.recommendation_id,
            ra.demand_id
          from indr.recommended_assignment ra
          join final_selected fs
            on fs.project_id = ra.project_id
          and fs.demand_id = ra.demand_id
          where ra.project_id = ${projectId}
            and ra.run_id = cast(${runId} as uuid)
            and indr.norm_text(coalesce(ra.recommendation_status, 'Draft')) not in (
              'REMOVED',
              'CANCELLED'
            )
        )

        insert into indr.recommended_assignment_wall (
          project_id,
          recommendation_id,
          demand_wall_id,
          wall_name,
          wall_area,
          assigned_area,
          remaining_area_after_assignment,
          wall_assignment_status
        )
        select
          ar.project_id,
          ar.recommendation_id,
          wdw.demand_wall_id,
          wdw.wall_name,
          wdw.wall_area,
          wdw.remaining_area,
          0,
          'Selected'
        from all_recommendations ar
        join indr.work_demand_wall wdw
          on wdw.project_id = ar.project_id
        and wdw.demand_id = ar.demand_id
        where coalesce(wdw.wall_name, '') <> '__HOUR_BASED__'
        on conflict (recommendation_id, wall_name) do nothing
      `;

          await tx.$executeRaw`
            select indr.assignment_cleanup_duplicate_recommendations(
              ${projectId},
              cast(${runId} as uuid)
            )
          `;

          await tx.$executeRaw`
            select indr.assignment_cleanup_invalid_system_recommendations(
              ${projectId},
              cast(${runId} as uuid)
            )
          `;

          await tx.$executeRaw`
            update indr.assignment_run ar
            set status = 'Generated'
            where ar.project_id = ${projectId}
              and ar.run_id = cast(${runId} as uuid)
              and ar.status = 'Draft'
          `;
        },
        this.ASSIGNMENT_LONG_TRANSACTION_OPTIONS,
      );

      await this.promoteRunFloorRestrictionsToDefaults(projectId, runId);

      return {
        run: await this.getAssignmentRunById(projectId, runId),
        recommendations: await this.getRecommendations(projectId, runId),
        recommendationWalls: [],
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await this.applyLongSqlTimeout(tx);

      /*
        FINAL AUTO-RECOMMENDATION RULES

        1. Cleaning / Helping:
           - never auto-recommended
           - manual Add Hours only
           - never rollover

        2. QC Rework:
           - never auto-recommended
           - manual Add / Add Partial only

        3. Rollover:
           - auto-recommended only when Include Rollover is ON (default)
           - billable true or false both allowed
           - multiple non-billable rollover rows allowed

        4. Ongoing / Next Layer:
           - only billable = true
           - only one billable layer per flat
           - if billable rollover already exists for the flat, do not assign Ongoing/Next Layer
           - Ongoing gets priority over Next Layer
           - lowest layer_order first

        5. Flat order:
           - lower flat serial first
      */

      await tx.$executeRaw`
        delete from indr.recommended_assignment_wall raw
        using indr.recommended_assignment ra,
              indr.work_demand_item wdi
        where raw.project_id = ${projectId}
          and ra.project_id = ${projectId}
          and wdi.project_id = ${projectId}
          and raw.project_id = ra.project_id
          and raw.recommendation_id = ra.recommendation_id
          and ra.project_id = wdi.project_id
          and ra.demand_id = wdi.demand_id
          and ra.run_id = cast(${runId} as uuid)
          and coalesce(ra.is_manual_edit, false) = false
          and indr.norm_text(coalesce(ra.created_by, 'system')) = 'SYSTEM'
          and (
            indr.assignment_is_helper_work_layer(ra.layer_name)
            or indr.norm_text(coalesce(wdi.section, '')) = 'QC REWORK'
            or (
              indr.norm_text(coalesce(wdi.section, '')) <> 'ROLLOVER'
              and coalesce(wdi.billable, false) = false
            )
          )
      `;

      await tx.$executeRaw`
        delete from indr.recommended_assignment ra
        using indr.work_demand_item wdi
        where ra.project_id = ${projectId}
          and wdi.project_id = ${projectId}
          and ra.project_id = wdi.project_id
          and ra.demand_id = wdi.demand_id
          and ra.run_id = cast(${runId} as uuid)
          and coalesce(ra.is_manual_edit, false) = false
          and indr.norm_text(coalesce(ra.created_by, 'system')) = 'SYSTEM'
          and (
            indr.assignment_is_helper_work_layer(ra.layer_name)
            or indr.norm_text(coalesce(wdi.section, '')) = 'QC REWORK'
            or (
              indr.norm_text(coalesce(wdi.section, '')) <> 'ROLLOVER'
              and coalesce(wdi.billable, false) = false
            )
          )
      `;

      await tx.$executeRaw`
        with run_context as (
          select
            ar.project_id,
            ar.run_id,
            ar.assignment_date,
            coalesce(cap.available_hours, 0)::numeric as available_hours
          from indr.assignment_run ar
          left join lateral (
            select available_hours
            from indr.assignment_get_worker_capacity(
              ar.assignment_date,
              ar.project_id,
              ${siteName}
            )
            limit 1
          ) cap on true
          where ar.project_id = ${projectId}
            and ar.run_id = cast(${runId} as uuid)
        ),

        eligible as (
          select
            wdi.project_id,
            wdi.run_id,
            wdi.demand_id,
            wdi.block,
            wdi.application,
            wdi.flat,
            wdi.layer_id,
            wdi.layer_name,
            wdi.surface_type,
            coalesce(wdi.remaining_area, 0)::numeric as remaining_area,
            coalesce(wdi.required_hours, 0)::numeric as required_hours,
            coalesce(wdi.section, '')::text as section,
            coalesce(wdi.eligibility_status, '')::text as eligibility_status,
            wdi.machine_or_manual,
            coalesce(wdi.productivity_per_hour, 0)::numeric as productivity_per_hour,
            wdi.productivity_mode_rule,
            coalesce(wdi.billable, false)::boolean as billable,
            coalesce(wdi.layer_order, 999)::numeric as layer_order,

            case
              when regexp_replace(coalesce(wdi.flat, ''), '\\D', '', 'g') ~ '^[0-9]+$'
              then regexp_replace(coalesce(wdi.flat, ''), '\\D', '', 'g')::numeric
              else 999999
            end as flat_sort,

            case
              when indr.norm_text(coalesce(wdi.section, '')) = 'ROLLOVER' then 1
              when indr.norm_text(coalesce(wdi.section, '')) = 'ONGOING' then 2
              when indr.norm_text(coalesce(wdi.section, '')) in (
                'NEXT LAYER READY',
                'NEW LAYER',
                'FRESH FLATS'
              ) then 3
              else 99
            end as section_priority,

            case
              when indr.norm_text(coalesce(wdi.surface_type, '')) = 'CEILING' then 1
              when indr.norm_text(coalesce(wdi.surface_type, '')) = 'WALL' then 2
              else 3
            end as surface_priority

          from indr.work_demand_item wdi
          left join indr.assignment_run_application_scope app_scope
            on app_scope.project_id = wdi.project_id
           and app_scope.run_id = wdi.run_id
           and app_scope.application_key = upper(trim(coalesce(wdi.application, '')))
          left join indr.assignment_run_layer_scope layer_scope
            on layer_scope.project_id = wdi.project_id
           and layer_scope.run_id = wdi.run_id
           and layer_scope.application_key = upper(trim(coalesce(wdi.application, '')))
           and layer_scope.layer_name_key = upper(trim(coalesce(wdi.layer_name, '')))
          where wdi.project_id = ${projectId}
            and wdi.run_id = cast(${runId} as uuid)
            and not indr.assignment_is_helper_work_layer(wdi.layer_name)
            and indr.norm_text(coalesce(wdi.section, '')) <> 'QC REWORK'
            and (
              ${includeRollover}::boolean = true
              or indr.norm_text(coalesce(wdi.section, '')) <> 'ROLLOVER'
            )
            and not exists (
              select 1
              from indr.assignment_run_floor_restriction floor_scope
              where floor_scope.project_id = wdi.project_id
                and floor_scope.run_id = wdi.run_id
                and floor_scope.block_key = upper(trim(coalesce(wdi.block, '')))
                and indr.assignment_floor_no(wdi.flat) = any(floor_scope.blocked_floors)
            )
            and coalesce(wdi.billable, false) = true
            and (
              indr.norm_text(coalesce(wdi.section, '')) = 'ROLLOVER'
              or (
                coalesce(app_scope.is_allowed, true) = true
                and coalesce(layer_scope.is_allowed, true) = true
              )
            )
            and coalesce(wdi.remaining_area, 0) > 0
            and coalesce(wdi.required_hours, 0) > 0
        ),

        rollover_rows as (
          select *
          from eligible
          where indr.norm_text(section) = 'ROLLOVER'
        ),

        billable_rollover_flats as (
          select distinct
            project_id,
            indr.norm_text(application) as application_key,
            indr.norm_text(flat) as flat_key
          from rollover_rows
          where billable = true
        ),

        ongoing_layer_candidates as (
          select
            x.*,
            row_number() over (
              partition by
                x.project_id,
                indr.norm_text(x.application),
                indr.norm_text(x.flat)
              order by
                x.layer_order,
                x.layer_name,
                x.layer_id
            ) as rn
          from (
            select distinct
              e.project_id,
              e.application,
              e.flat,
              e.layer_id,
              e.layer_name,
              e.layer_order,
              e.flat_sort
            from eligible e
            left join billable_rollover_flats brf
              on brf.project_id = e.project_id
            and brf.application_key = indr.norm_text(e.application)
            and brf.flat_key = indr.norm_text(e.flat)
            where indr.norm_text(e.section) = 'ONGOING'
              and e.billable = true
              and brf.flat_key is null
          ) x
        ),

        selected_ongoing_layers as (
          select *
          from ongoing_layer_candidates
          where rn = 1
        ),

        selected_ongoing as (
          select e.*
          from eligible e
          join selected_ongoing_layers sol
            on sol.project_id = e.project_id
          and indr.norm_text(sol.application) = indr.norm_text(e.application)
          and indr.norm_text(sol.flat) = indr.norm_text(e.flat)
          and (
              indr.norm_text(sol.layer_id) = indr.norm_text(e.layer_id)
              or indr.norm_text(sol.layer_name) = indr.norm_text(e.layer_name)
          )
          where indr.norm_text(e.section) = 'ONGOING'
            and e.billable = true
        ),

        ongoing_selected_flats as (
          select distinct
            project_id,
            indr.norm_text(application) as application_key,
            indr.norm_text(flat) as flat_key
          from selected_ongoing
        ),

        next_layer_candidates as (
          select
            x.*,
            row_number() over (
              partition by
                x.project_id,
                indr.norm_text(x.application),
                indr.norm_text(x.flat)
              order by
                x.layer_order,
                x.layer_name,
                x.layer_id
            ) as rn
          from (
            select distinct
              e.project_id,
              e.application,
              e.flat,
              e.layer_id,
              e.layer_name,
              e.layer_order,
              e.flat_sort
            from eligible e
            left join billable_rollover_flats brf
              on brf.project_id = e.project_id
            and brf.application_key = indr.norm_text(e.application)
            and brf.flat_key = indr.norm_text(e.flat)
            left join ongoing_selected_flats osf
              on osf.project_id = e.project_id
            and osf.application_key = indr.norm_text(e.application)
            and osf.flat_key = indr.norm_text(e.flat)
            where indr.norm_text(e.section) in (
                'NEXT LAYER READY',
                'NEW LAYER',
                'FRESH FLATS'
              )
              and e.billable = true
              and brf.flat_key is null
              and osf.flat_key is null
          ) x
        ),

        selected_next_layer_layers as (
          select *
          from next_layer_candidates
          where rn = 1
        ),

        selected_next_layer as (
          select e.*
          from eligible e
          join selected_next_layer_layers snl
            on snl.project_id = e.project_id
          and indr.norm_text(snl.application) = indr.norm_text(e.application)
          and indr.norm_text(snl.flat) = indr.norm_text(e.flat)
          and (
              indr.norm_text(snl.layer_id) = indr.norm_text(e.layer_id)
              or indr.norm_text(snl.layer_name) = indr.norm_text(e.layer_name)
          )
          where indr.norm_text(e.section) in (
              'NEXT LAYER READY',
              'NEW LAYER',
              'FRESH FLATS'
            )
            and e.billable = true
        ),

        priority_selected as (
          select
            project_id,
            run_id,
            demand_id,
            block,
            application,
            flat,
            layer_id,
            layer_name,
            surface_type,
            remaining_area,
            required_hours,
            section,
            eligibility_status,
            machine_or_manual,
            productivity_per_hour,
            productivity_mode_rule,
            billable,
            layer_order,
            flat_sort,
            section_priority,
            surface_priority
          from rollover_rows

          union all

          select
            project_id,
            run_id,
            demand_id,
            block,
            application,
            flat,
            layer_id,
            layer_name,
            surface_type,
            remaining_area,
            required_hours,
            section,
            eligibility_status,
            machine_or_manual,
            productivity_per_hour,
            productivity_mode_rule,
            billable,
            layer_order,
            flat_sort,
            section_priority,
            surface_priority
          from selected_ongoing

          union all

          select
            project_id,
            run_id,
            demand_id,
            block,
            application,
            flat,
            layer_id,
            layer_name,
            surface_type,
            remaining_area,
            required_hours,
            section,
            eligibility_status,
            machine_or_manual,
            productivity_per_hour,
            productivity_mode_rule,
            billable,
            layer_order,
            flat_sort,
            section_priority,
            surface_priority
          from selected_next_layer
        ),

        ordered_priority_selected as (
          select
            ps.*,
            sum(ps.required_hours) over (
              order by
                ps.section_priority,
                ps.flat_sort,
                ps.flat,
                ps.layer_order,
                ps.surface_priority,
                ps.layer_name,
                ps.demand_id
              rows between unbounded preceding and current row
            )::numeric as cumulative_hours
          from priority_selected ps
        ),

        final_selected as (
          select ops.*
          from ordered_priority_selected ops
          cross join run_context rc
          where rc.available_hours > 0
            and ops.cumulative_hours <= rc.available_hours
        ),

        inserted_recommendations as (
          insert into indr.recommended_assignment (
            project_id,
            run_id,
            demand_id,
            block,
            application,
            flat,
            layer_id,
            layer_name,
            surface_type,
            assigned_area,
            required_hours,
            assignment_type,
            recommendation_reason,
            warning_status,
            machine_or_manual,
            selected_productivity_per_hour,
            productivity_mode_rule,
            painter_count,
            recommendation_status,
            is_manual_edit,
            created_by,
            created_at
          )
          select
            fs.project_id,
            fs.run_id,
            fs.demand_id,
            fs.block,
            fs.application,
            fs.flat,
            fs.layer_id,
            fs.layer_name,
            fs.surface_type,
            fs.remaining_area,
            fs.required_hours,
            'Full',
            fs.section,
            case
              when indr.norm_text(fs.eligibility_status) = 'MISSING PRODUCTIVITY'
              then 'Missing Productivity'
              else null
            end,
            fs.machine_or_manual,
            fs.productivity_per_hour,
            fs.productivity_mode_rule,
            0,
            'Draft',
            false,
            'system',
            now()
          from final_selected fs
          where not exists (
            select 1
            from indr.recommended_assignment ra
            where ra.project_id = fs.project_id
              and ra.demand_id = fs.demand_id
              and indr.norm_text(coalesce(ra.recommendation_status, 'Draft')) not in (
                'REMOVED',
                'CANCELLED'
              )
          )
          order by
            fs.section_priority,
            fs.flat_sort,
            fs.layer_order,
            fs.surface_priority,
            fs.layer_name
          returning project_id, recommendation_id, demand_id
        ),

        all_recommendations as (
          select
            ir.project_id,
            ir.recommendation_id,
            ir.demand_id
          from inserted_recommendations ir

          union

          select
            ra.project_id,
            ra.recommendation_id,
            ra.demand_id
          from indr.recommended_assignment ra
          join final_selected fs
            on fs.project_id = ra.project_id
          and fs.demand_id = ra.demand_id
          where ra.project_id = ${projectId}
            and ra.run_id = cast(${runId} as uuid)
            and indr.norm_text(coalesce(ra.recommendation_status, 'Draft')) not in (
              'REMOVED',
              'CANCELLED'
            )
        )

        insert into indr.recommended_assignment_wall (
          project_id,
          recommendation_id,
          demand_wall_id,
          wall_name,
          wall_area,
          assigned_area,
          remaining_area_after_assignment,
          wall_assignment_status
        )
        select
          ar.project_id,
          ar.recommendation_id,
          wdw.demand_wall_id,
          wdw.wall_name,
          wdw.wall_area,
          wdw.remaining_area,
          0,
          'Selected'
        from all_recommendations ar
        join indr.work_demand_wall wdw
          on wdw.project_id = ar.project_id
        and wdw.demand_id = ar.demand_id
        where coalesce(wdw.wall_name, '') <> '__HOUR_BASED__'
        on conflict (recommendation_id, wall_name) do nothing
      `;

      await tx.$executeRaw`
        select indr.assignment_cleanup_invalid_system_recommendations(
          ${projectId},
          cast(${runId} as uuid)
        )
      `;

      await tx.$executeRaw`
        update indr.assignment_run
        set status = 'Generated'
        where project_id = ${projectId}
          and run_id = cast(${runId} as uuid)
          and status = 'Draft'
      `;
    }, this.ASSIGNMENT_LONG_TRANSACTION_OPTIONS);

    await this.promoteRunFloorRestrictionsToDefaults(projectId, runId);

    return {
      run: await this.getAssignmentRunById(projectId, runId),
      recommendations: await this.getRecommendations(projectId, runId),
      recommendationWalls: await this.getRecommendationWalls(projectId, runId),
    };
  }


  async getRecommendations(projectId: string, runId: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select
        ra.*,
        wdi.wall_names as demand_wall_names,
        wdi.wall_count as demand_wall_count
      from indr.recommended_assignment ra
      left join indr.work_demand_item wdi
        on wdi.project_id = ra.project_id
       and wdi.run_id = ra.run_id
       and wdi.demand_id = ra.demand_id
      where ra.project_id = ${projectId}
        and ra.run_id = cast(${runId} as uuid)
      order by
        case
          when indr.norm_text(coalesce(wdi.section, ra.recommendation_reason, '')) = 'ROLLOVER' then 1
          when indr.norm_text(coalesce(wdi.section, ra.recommendation_reason, '')) = 'ONGOING' then 2
          when indr.norm_text(coalesce(wdi.section, ra.recommendation_reason, '')) in (
            'NEXT LAYER READY',
            'NEW LAYER',
            'FRESH FLATS'
          ) then 3
          when indr.norm_text(coalesce(wdi.section, ra.recommendation_reason, '')) = 'QC REWORK' then 4
          else 99
        end,
        case
          when regexp_replace(coalesce(ra.flat, ''), '\\D', '', 'g') ~ '^[0-9]+$'
          then regexp_replace(coalesce(ra.flat, ''), '\\D', '', 'g')::numeric
          else 999999
        end,
        coalesce(wdi.layer_order, 999),
        case
          when indr.norm_text(coalesce(ra.surface_type, '')) = 'CEILING' then 1
          when indr.norm_text(coalesce(ra.surface_type, '')) = 'WALL' then 2
          else 3
        end,
        ra.layer_name
    `;

    return this.normalizeRows(rows);
  }
  async getRecommendationWalls(projectId: string, runId: string) {
    this.assertAssignmentProject(projectId);

    const rows =
      projectId !== 'indradhanush'
        ? await this.prisma.$queryRaw<any[]>`
            select raw.*
            from indr.recommended_assignment ra
            join indr.recommended_assignment_wall raw
              on raw.project_id = ra.project_id
             and raw.recommendation_id = ra.recommendation_id
            where ra.project_id = ${projectId}
              and ra.run_id = cast(${runId} as uuid)
              and coalesce(ra.is_manual_edit, false) = true
              and indr.norm_text(coalesce(ra.recommendation_status, 'Draft')) not in (
                'REMOVED',
                'CANCELLED'
              )
              and indr.norm_text(coalesce(raw.wall_assignment_status, 'Selected')) not in (
                'REMOVED',
                'CANCELLED'
              )
            order by raw.recommendation_id, raw.wall_name
          `
        : await this.prisma.$queryRaw<any[]>`
            with target_recommendations as (
              select recommendation_id
              from indr.recommended_assignment
              where project_id = ${projectId}
                and run_id = cast(${runId} as uuid)
            )

            select raw.*
            from target_recommendations tr
            join indr.recommended_assignment_wall raw
              on raw.project_id = ${projectId}
             and raw.recommendation_id = tr.recommendation_id
            where raw.project_id = ${projectId}
            order by raw.recommendation_id, raw.wall_name
          `;

    return this.normalizeRows(rows);
  }

  async updateRecommendationWorkMode(
    projectId: string,
    recommendationId: string,
    machineOrManual: string,
  ) {
    this.assertAssignmentProject(projectId);

    const recommendationRows = await this.prisma.$queryRaw<any[]>`
      select recommendation_id
      from indr.recommended_assignment
      where project_id = ${projectId}
        and recommendation_id = cast(${recommendationId} as uuid)
      limit 1
    `;

    if (!recommendationRows.length) {
      throw new NotFoundException('Recommendation not found');
    }

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_update_recommendation_work_mode(
        cast(${recommendationId} as uuid),
        ${machineOrManual}
      )
    `;

    return this.normalizeRows(rows);
  }
  async finalizeRun(
    projectId: string,
    runId: string,
    finalizedBy = 'system',
    overrideReason?: string,
  ) {
    this.assertAssignmentProject(projectId);

    await this.getAssignmentRunById(projectId, runId);

    const publishReason = overrideReason?.trim() || null;

    await this.prisma.$transaction(async (tx) => {
      await this.applyLongSqlTimeout(tx);

      await tx.$executeRaw`
        with inserted_final as (
          insert into indr.final_assignment (
            project_id,
            run_id,
            recommendation_id,
            assignment_date,
            block,
            application,
            flat,
            layer_id,
            layer_name,
            surface_type,
            assigned_area,
            expected_hours,
            required_hours,
            machine_or_manual,
            painter_count,
            assigned_painter_ids,
            assigned_painter_names,
            status,
            published_at,
            published_by,
            created_at
          )
          select
            ra.project_id,
            ra.run_id,
            ra.recommendation_id,
            ar.assignment_date,
            ra.block,
            ra.application,
            ra.flat,
            ra.layer_id,
            ra.layer_name,
            ra.surface_type,
            ra.assigned_area,
            ra.required_hours,
            ra.required_hours,
            ra.machine_or_manual,
            ra.painter_count,
            ra.assigned_painter_ids,
            ra.assigned_painter_names,
            'Published',
            now(),
            ${finalizedBy},
            now()
          from indr.recommended_assignment ra
          join indr.assignment_run ar
            on ar.project_id = ra.project_id
           and ar.run_id = ra.run_id
          where ra.project_id = ${projectId}
            and ra.run_id = cast(${runId} as uuid)
            and indr.norm_text(ra.recommendation_status) not in ('REMOVED', 'CANCELLED')
            and not exists (
              select 1
              from indr.final_assignment fa
              where fa.project_id = ra.project_id
                and fa.recommendation_id = ra.recommendation_id
            )
          returning project_id, assignment_id, recommendation_id
        ),
        all_final as (
          select project_id, assignment_id, recommendation_id
          from inserted_final

          union

          select project_id, assignment_id, recommendation_id
          from indr.final_assignment
          where project_id = ${projectId}
            and run_id = cast(${runId} as uuid)
        )
        insert into indr.final_assignment_wall (
          project_id,
          assignment_id,
          wall_name,
          wall_area,
          assigned_area,
          reported_area,
          wall_status
        )
        select
          af.project_id,
          af.assignment_id,
          raw.wall_name,
          raw.wall_area,
          raw.assigned_area,
          0,
          'Assigned'
        from all_final af
        join indr.recommended_assignment_wall raw
          on raw.project_id = af.project_id
         and raw.recommendation_id = af.recommendation_id
        where raw.project_id = ${projectId}
          and indr.norm_text(raw.wall_assignment_status) not in ('REMOVED', 'CANCELLED')
        on conflict (assignment_id, wall_name) do nothing
      `;

      await tx.$executeRaw`
        update indr.recommended_assignment
        set recommendation_status = 'Finalized'
        where project_id = ${projectId}
          and run_id = cast(${runId} as uuid)
          and indr.norm_text(recommendation_status) not in ('REMOVED', 'CANCELLED')
      `;

      await tx.$executeRaw`
        insert into indr.assignment_change_log (
          project_id,
          run_id,
          field_changed,
          old_value,
          new_value,
          reason,
          changed_by,
          changed_at,
          approval_required
        )
        values (
          ${projectId},
          cast(${runId} as uuid),
          'run_status',
          'Generated',
          'Finalized',
          ${publishReason},
          ${finalizedBy},
          now(),
          false
        )
      `;

      await tx.$executeRaw`
        update indr.assignment_run
        set status = 'Finalized'
        where project_id = ${projectId}
          and run_id = cast(${runId} as uuid)
      `;
    }, this.ASSIGNMENT_LONG_TRANSACTION_OPTIONS);

    return {
      run: await this.getAssignmentRunById(projectId, runId),
      finalAssignments: await this.getFinalAssignments(projectId, runId),
      finalAssignmentWalls: await this.getFinalAssignmentWalls(projectId, runId),
    };
  }


  async getFinalAssignments(projectId: string, runId?: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.final_assignment
      where project_id = ${projectId}
        and (${runId ?? null}::text is null or run_id = cast(${runId ?? null} as uuid))
      order by assignment_date desc, application, flat, layer_name, surface_type
    `;

    return this.normalizeRows(rows);
  }
  async getFinalAssignmentWalls(projectId: string, runId?: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select
        faw.*
      from indr.final_assignment_wall faw
      join indr.final_assignment fa
        on fa.project_id = faw.project_id
       and fa.assignment_id = faw.assignment_id
      where faw.project_id = ${projectId}
        and (${runId ?? null}::text is null or fa.run_id = cast(${runId ?? null} as uuid))
      order by fa.assignment_date desc, fa.application, fa.flat, fa.layer_name, faw.wall_name
    `;

    return this.normalizeRows(rows);
  }
  async getTodayPainterAttendance(projectId: string) {
    this.assertAssignmentProject(projectId);

    if (!this.JIBBLE_LOCATION_BY_PROJECT[projectId]) {
      // No Jibble location has been configured for this new project yet.
      // This is independent of painter master and painter_availability.
      const timezone = this.JIBBLE_TIMEZONE;
      const attendanceDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      return {
        project_id: projectId,
        site_name: await this.getProjectSiteName(projectId),
        attendance_date: attendanceDate,
        timezone,
        present_painter_count: 0,
        currently_on_site_count: 0,
        painters: [],
      };
    }

    const locationName = this.getJibbleLocationName(projectId);
    const timezone = this.JIBBLE_TIMEZONE;

    const rows = await this.prisma.$queryRaw<any[]>`
      with attendance_day as (
        select (now() at time zone ${timezone})::date as attendance_date
      ),

      member_entries as (
        select
          entries.jibble_entry_id,
          entries.person_id,
          entries.entry_date,
          upper(trim(coalesce(entries.entry_type, ''))) as entry_type,
          entries.entry_time,
          coalesce(
            people.full_name,
            entries.author_name,
            entries.person_id::text
          )::text as painter_name,
          people.member_code::text as member_code,
          upper(
            trim(
              coalesce(
                nullif(entries.role, ''),
                nullif(people.role, ''),
                ''
              )
            )
          ) as effective_role,
          coalesce(
            nullif(entries.location_name, ''),
            nullif(locations.location_name, '')
          )::text as effective_location
        from indr.jibble_time_entries entries
        left join indr.jibble_people people
          on people.person_id = entries.person_id
        left join indr.jibble_locations locations
          on locations.location_id = entries.location_id
        cross join attendance_day day
        where entries.person_id is not null
          and entries.entry_date = day.attendance_date
          and upper(
            trim(
              coalesce(
                nullif(entries.role, ''),
                nullif(people.role, ''),
                ''
              )
            )
          ) = 'MEMBER'
          and upper(trim(coalesce(entries.entry_type, ''))) in ('IN', 'OUT')
      ),

      first_site_clock_in as (
        select
          person_id,
          min(entry_time) as clock_in_time
        from member_entries
        where entry_type = 'IN'
          and entry_time is not null
          and upper(trim(coalesce(effective_location, ''))) =
              upper(trim(${locationName}))
        group by person_id
      ),

      person_day_summary as (
        select
          site_in.person_id,
          site_in.clock_in_time,
          max(entries.painter_name) filter (
            where entries.painter_name is not null
          ) as painter_name,
          max(entries.member_code) filter (
            where entries.member_code is not null
          ) as member_code,
          max(entries.entry_time) filter (
            where entries.entry_type = 'OUT'
              and entries.entry_time >= site_in.clock_in_time
          ) as latest_clock_out_time
        from first_site_clock_in site_in
        join member_entries entries
          on entries.person_id = site_in.person_id
         and entries.entry_time >= site_in.clock_in_time
        group by
          site_in.person_id,
          site_in.clock_in_time
      ),

      latest_person_entry as (
        select distinct on (entries.person_id)
          entries.person_id,
          entries.entry_type as latest_entry_type
        from member_entries entries
        join first_site_clock_in site_in
          on site_in.person_id = entries.person_id
         and entries.entry_time >= site_in.clock_in_time
        where entries.entry_time is not null
        order by
          entries.person_id,
          entries.entry_time desc,
          entries.jibble_entry_id desc
      )

      select
        summary.person_id::text as person_id,
        summary.painter_name,
        summary.member_code,
        summary.clock_in_time,
        to_char(
          summary.clock_in_time at time zone ${timezone},
          'FMHH12:MI AM'
        ) as clock_in_time_display,
        case
          when latest.latest_entry_type = 'OUT'
          then summary.latest_clock_out_time
          else null
        end as clock_out_time,
        case
          when latest.latest_entry_type = 'OUT'
           and summary.latest_clock_out_time is not null
          then to_char(
            summary.latest_clock_out_time at time zone ${timezone},
            'FMHH12:MI AM'
          )
          else null
        end as clock_out_time_display,
        (latest.latest_entry_type = 'IN')::boolean as currently_on_site
      from person_day_summary summary
      join latest_person_entry latest
        on latest.person_id = summary.person_id
      order by
        summary.clock_in_time,
        summary.painter_name
    `;

    const painters = this.normalizeRows<any>(rows);
    const attendanceDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    return {
      project_id: projectId,
      site_name: locationName,
      attendance_date: attendanceDate,
      timezone,
      present_painter_count: painters.length,
      currently_on_site_count: painters.filter(
        (painter) => painter.currently_on_site === true,
      ).length,
      painters,
    };
  }

  async getDefaultReportingAssignmentDate(projectId: string) {
    this.assertAssignmentProject(projectId);

    // Reporting should open on the latest assignment date that is not in the
    // future. This avoids loading all Assignment Engine data just to choose a
    // default date and keeps the reporting page lightweight.
    const rows = await this.prisma.$queryRaw<Array<{ assignment_date: string }>>`
      select coalesce(
        max(fa.assignment_date) filter (where fa.assignment_date <= current_date),
        current_date
      )::text as assignment_date
      from indr.final_assignment fa
      where fa.project_id = ${projectId}
        and indr.norm_text(coalesce(fa.status, '')) not in (
          'REPLACED',
          'CANCELLED',
          'REMOVED'
        )
    `;

    return {
      assignment_date: rows[0]?.assignment_date ?? null,
    };
  }

  async getTodayAssignedReporting(projectId: string) {
    this.assertAssignmentProject(projectId);

    // Assigned Work must carry the same material suggestion that is shown
    // when the row is opened in Edit mode. Build the project's latest
    // material mapping once and join it set-wise to the assigned rows.
    const rows = await this.prisma.$queryRaw<any[]>`
      with latest_material as (
        select distinct on (
          indr.norm_text(material_option.application),
          indr.norm_text(material_option.layer_name)
        )
          material_option.project_id,
          material_option.application,
          material_option.layer_name,
          material_option.material_name,
          material_option.coverage
        from indr.assignment_v_reporting_material_options material_option
        where material_option.project_id = ${projectId}
        order by
          indr.norm_text(material_option.application),
          indr.norm_text(material_option.layer_name),
          material_option.updated_at desc
      )
      select
        assigned.*,
        material.material_name,
        material.coverage as material_coverage,
        case
          when indr.assignment_is_hour_based_layer(assigned.layer_name)
            or indr.assignment_is_helper_work_layer(assigned.layer_name)
          then 0::numeric
          when coalesce(material.coverage, 0) > 0
          then round(
            coalesce(assigned.pending_area, assigned.assigned_area, 0)::numeric
            / nullif(material.coverage, 0)::numeric,
            2
          )
          else 0::numeric
        end as material_used_l_kg
      from indr.assignment_v_reporting_today_assigned assigned
      left join latest_material material
        on material.project_id = assigned.project_id
       and indr.norm_text(material.application)
           = indr.norm_text(assigned.application)
       and indr.norm_text(material.layer_name)
           = indr.norm_text(assigned.layer_name)
      where assigned.project_id = ${projectId}
      order by
        assigned.application,
        assigned.flat,
        assigned.layer_name,
        assigned.surface_type
    `;

    return this.normalizeRows(rows);
  }
  async submitReporting(projectId: string, dto: SubmitReportingDto) {
    this.assertAssignmentProject(projectId);

    const assignmentId = dto.assignmentId || null;

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_submit_reporting_v2(
        ${projectId},
        ${dto.block},
        ${dto.application},
        ${dto.flat},
        ${dto.layerId},
        ${dto.wallNames ?? []}::text[],
        ${dto.painterNames ?? []}::text[],
        ${dto.machineOrManual},
        ${dto.workingHours ?? 0},
        cast(${dto.workDate ?? null} as date),
        cast(${assignmentId} as uuid),
        ${dto.materialName ?? null},
        ${dto.materialUsedLKg ?? 0},
        ${dto.remark ?? null}
      )
    `;

    // Keep only the touched TRUE hour-based layer's stored wkdpct current.
    // This is one indexed/set-based update; it does not run a full project refresh.
    await this.syncStoredHourBasedWkdpct(projectId, [dto.layerId]);

    return this.normalizeRows(rows);
  }

  async bulkSubmitAssignedReporting(
    projectId: string,
    dto: BulkSubmitAssignedReportingDto,
  ) {
    this.assertAssignmentProject(projectId);

    const items = dto.items ?? [];

    if (!items.length) {
      throw new BadRequestException('At least one assigned row is required.');
    }

    /**
     * Reporting fast path v2: insert-only.
     *
     * This endpoint intentionally does NOT call:
     * - indr.assignment_submit_reporting_v2(...)
     * - indr.assignment_bulk_submit_assigned_reporting(...)
     * - layer progress refresh
     * - demand/recommendation refresh
     * - final assignment wall/status sync
     *
     * Why:
     * Those sync/update queries were the ones causing 30s+ submits and
     * statement_timeout for bulk reporting. Existing Assigned Work and Rollover
     * views already compare against indr.backend Done rows, so the backend row is
     * enough for reporting source-of-truth and for removing the submitted work
     * from pending/rollover when those views are fetched/regenerated.
     *
     * Heavy syncs should happen only when their own pages are opened/regenerated,
     * not during reporting submit.
     *
     * Painter names and per-painter working hours are scalar values supplied by
     * the frontend. They are written in the same INSERT and do not add any
     * reporting-side refresh or extra database lookup.
     */
    const prepared = items.map((item, index) => {
      const assignmentId = String(item.assignmentId ?? '').trim();
      const application = String(item.application ?? '').trim();
      const flat = String(item.flat ?? '').trim();
      const layerId = String(item.layerId ?? '').trim();
      const layerName = String(item.layerName ?? '').trim();

      const wallNames = (item.wallNames ?? [])
        .map((wallName) => String(wallName ?? '').trim())
        .filter(Boolean);

      const pendingArea = Math.max(0, Number(item.pendingArea ?? 0));
      const workingHours = Math.max(0, Number(item.workingHours ?? 0));
      const isHourBasedLike = wallNames.length === 0 && pendingArea <= 0;

      if (!assignmentId) {
        throw new BadRequestException(
          `Row ${index + 1}: assignmentId is required.`,
        );
      }

      if (!application) {
        throw new BadRequestException(
          `Row ${index + 1}: application is required.`,
        );
      }

      if (!flat) {
        throw new BadRequestException(`Row ${index + 1}: flat is required.`);
      }

      if (!layerId) {
        throw new BadRequestException(`Row ${index + 1}: layerId is required.`);
      }

      if (!layerName) {
        throw new BadRequestException(
          `Row ${index + 1}: layerName is required.`,
        );
      }

      if (!isHourBasedLike && wallNames.length === 0) {
        throw new BadRequestException(
          `Row ${index + 1}: wall selection is required for area-based reporting.`,
        );
      }

      if (!isHourBasedLike && pendingArea <= 0) {
        throw new BadRequestException(
          `Row ${index + 1}: pendingArea is required for area-based reporting.`,
        );
      }

      return {
        assignmentId,
        block: item.block ?? null,
        application,
        flat,
        layerId,
        layerName,
        wallNamesText: wallNames.length ? wallNames.join(', ') : null,
        area: isHourBasedLike ? 0 : pendingArea,
        painterNamesText: (item.painterNames ?? [])
          .map((name) => String(name ?? '').trim())
          .filter(Boolean)
          .join(', ') || null,
        machineOrManual: item.machineOrManual || 'Both',
        workingHours,
        workDate: item.workDate ?? null,
        materialName: item.materialName ?? null,
        materialUsedLKg: Math.max(0, Number(item.materialUsedLKg ?? 0)),
        remark:
          item.remark ||
          `Bulk assigned reporting submitted by ${dto.changedBy || 'system'}`,
      };
    });

    const insertedRows: any[] = [];

    for (const row of prepared) {
      const rows = await this.prisma.$queryRaw<any[]>`
        insert into indr.backend (
          assignment_id,
          layer_id,
          block,
          application,
          flat,
          work_layer,
          work_date,
          wall_names,
          area,
          painter_names,
          machine_or_manual,
          working_hours,
          work_status,
          material_name,
          material_used_l_kg,
          remark,
          project_id,
          created_at,
          updated_at
        )
        values (
          cast(${row.assignmentId} as uuid),
          ${row.layerId},
          ${row.block},
          ${row.application},
          ${row.flat},
          ${row.layerName},
          coalesce(nullif(${row.workDate ?? ''}, '')::date, current_date),
          ${row.wallNamesText},
          ${row.area},
          ${row.painterNamesText},
          coalesce(nullif(trim(${row.machineOrManual}), ''), 'Both'),
          ${row.workingHours},
          'Done',
          ${row.materialName},
          ${row.materialUsedLKg},
          ${row.remark},
          ${projectId},
          now(),
          now()
        )
        returning *
      `;

      insertedRows.push(...rows);
    }

    // Bulk reporting writes per-painter clock hours. Sync only the touched
    // true hour-based layers so their stored wkdpct reflects labour-hours immediately.
    await this.syncStoredHourBasedWkdpct(
      projectId,
      prepared.map((row) => row.layerId),
    );

    return this.normalizeRows(insertedRows);
  }

  async getCapacity(projectId: string, assignmentDate: string) {
    this.assertAssignmentProject(projectId);

    const siteName = await this.getProjectSiteName(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_get_worker_capacity(
        cast(${assignmentDate} as date),
        ${projectId},
        ${siteName}
      )
    `;

    return this.normalizeRow(rows[0] ?? {});
  }
  async getPlannedVsDone(projectId: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_v_planned_vs_done
      where project_id = ${projectId}
      order by assignment_date desc, application, flat, layer_name
    `;

    return this.normalizeRows(rows);
  }
  async getChangeLog(projectId: string, runId?: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_change_log
      where project_id = ${projectId}
        and (${runId ?? null}::text is null or run_id = cast(${runId ?? null} as uuid))
      order by changed_at desc
    `;

    return this.normalizeRows(rows);
  }
  private async logAssignmentChange(
    tx: any,
    params: {
      projectId?: string | null;
      runId?: string | null;
      recommendationId?: string | null;
      assignmentId?: string | null;
      fieldChanged: string;
      oldValue?: string | null;
      newValue?: string | null;
      reason?: string | null;
      changedBy?: string | null;
      approvalRequired?: boolean;
    },
  ) {
    if (!params.projectId) {
      throw new BadRequestException('projectId is required for assignment change log');
    }

    await tx.$executeRaw`
      insert into indr.assignment_change_log (
        project_id,
        run_id,
        recommendation_id,
        assignment_id,
        field_changed,
        old_value,
        new_value,
        reason,
        changed_by,
        changed_at,
        approval_required
      )
      values (
        ${params.projectId},
        ${params.runId ?? null}::uuid,
        ${params.recommendationId ?? null}::uuid,
        ${params.assignmentId ?? null}::uuid,
        ${params.fieldChanged},
        ${params.oldValue ?? null},
        ${params.newValue ?? null},
        ${params.reason ?? null},
        ${params.changedBy ?? 'system'},
        now(),
        ${params.approvalRequired ?? false}
      )
    `;
  }
  async addDemandToRecommendation(
    projectId: string,
    demandId: string,
    dto: AddDemandToRecommendationDto,
    isPartial: boolean,
  ) {
    this.assertAssignmentProject(projectId);

    const selectedWallNames = Array.isArray((dto as any).wallNames)
      ? (dto as any).wallNames
          .map((wall: unknown) => String(wall).trim())
          .filter(Boolean)
      : [];

    if (isPartial && selectedWallNames.length === 0) {
      throw new BadRequestException(
        'Select at least one wall for partial assignment.',
      );
    }

    let runId = dto.runId;

    await this.prisma.$transaction(async (tx) => {
      const demandRows = await tx.$queryRaw<any[]>`
        select *
        from indr.work_demand_item
        where project_id = ${projectId}
          and demand_id = cast(${demandId} as uuid)
          and run_id = cast(${dto.runId} as uuid)
        limit 1
      `;

      if (!demandRows.length) {
        throw new NotFoundException('Demand item not found');
      }

      const demand = demandRows[0];
      runId = demand.run_id;

      const blockedFloorRows = await tx.$queryRaw<any[]>`
        select exists (
          select 1
          from indr.assignment_run_floor_restriction floor_scope
          where floor_scope.project_id = ${projectId}
            and floor_scope.run_id = cast(${dto.runId} as uuid)
            and floor_scope.block_key = upper(trim(coalesce(${demand.block ?? null}, '')))
            and indr.assignment_floor_no(${demand.flat ?? null}) = any(floor_scope.blocked_floors)
        ) as is_blocked
      `;

      if (blockedFloorRows[0]?.is_blocked) {
        throw new BadRequestException(
          `Floor restriction blocks ${demand.block ?? 'this block'} / ${demand.flat ?? 'this flat'} for this assignment run.`,
        );
      }

      const productivity = Number(demand.productivity_per_hour ?? 0);

      if (productivity <= 0) {
        throw new BadRequestException(
          'Productivity missing. Update productivity before adding this demand.',
        );
      }

      const isHourBasedDemand = [
        'CLEANING',
        'HELPING',
        'MATERIAL SHIFTING',
      ].includes(String(demand.layer_name || '').trim().toUpperCase());

      if (isHourBasedDemand) {
        const hoursToAssign = Number(dto.assignedArea ?? 0);
        const remainingHours = Number(
          demand.remaining_hours ?? demand.remaining_area ?? demand.required_hours ?? 0,
        );

        if (!Number.isFinite(hoursToAssign) || hoursToAssign <= 0) {
          throw new BadRequestException('Enter valid hours to assign.');
        }

        if (remainingHours > 0 && hoursToAssign > remainingHours + 0.01) {
          throw new BadRequestException(
            `Only ${remainingHours} hours are remaining for this hour-based layer.`,
          );
        }

        const existingHourRows = await tx.$queryRaw<any[]>`
          select recommendation_id, assigned_area
          from indr.recommended_assignment
          where project_id = ${projectId}
            and run_id = cast(${dto.runId} as uuid)
            and demand_id = cast(${demandId} as uuid)
            and indr.norm_text(coalesce(recommendation_status, 'Draft')) not in (
              'REMOVED',
              'CANCELLED'
            )
          order by created_at asc nulls last, recommendation_id asc
          limit 1
        `;

        let recommendationId: string;

        if (existingHourRows.length > 0) {
          recommendationId = existingHourRows[0].recommendation_id;
        } else {
          const insertedHour = await tx.$queryRaw<any[]>`
            insert into indr.recommended_assignment (
              project_id,
              run_id,
              demand_id,
              block,
              application,
              flat,
              layer_id,
              layer_name,
              surface_type,
              assigned_area,
              required_hours,
              assignment_type,
              recommendation_reason,
              warning_status,
              machine_or_manual,
              selected_productivity_per_hour,
              productivity_mode_rule,
              painter_count,
              recommendation_status,
              is_manual_edit,
              override_reason,
              created_by,
              created_at,
              edited_by,
              edited_at
            )
            values (
              ${projectId},
              cast(${dto.runId} as uuid),
              cast(${demandId} as uuid),
              ${demand.block ?? null},
              ${demand.application},
              ${demand.flat},
              ${demand.layer_id},
              ${demand.layer_name},
              null,
              0,
              0,
              'Hour Based',
              'Hour Based',
              null,
              ${demand.machine_or_manual ?? 'Both'},
              1,
              ${demand.productivity_mode_rule ?? 'Hour Based'},
              0,
              'Draft',
              true,
              ${dto.reason ?? null},
              ${dto.changedBy ?? 'system'},
              now(),
              ${dto.changedBy ?? 'system'},
              now()
            )
            returning recommendation_id
          `;

          recommendationId = insertedHour[0].recommendation_id;
        }

        await tx.$queryRaw<any[]>`
          update indr.recommended_assignment
          set
            assigned_area = least(
              coalesce(assigned_area, 0)::numeric + cast(${hoursToAssign} as numeric),
              greatest(cast(${remainingHours} as numeric), cast(${hoursToAssign} as numeric))
            ),
            required_hours = least(
              coalesce(required_hours, 0)::numeric + cast(${hoursToAssign} as numeric),
              greatest(cast(${remainingHours} as numeric), cast(${hoursToAssign} as numeric))
            ),
            assignment_type = 'Hour Based',
            recommendation_reason = 'Hour Based',
            warning_status = null,
            surface_type = null,
            machine_or_manual = ${demand.machine_or_manual ?? 'Both'},
            selected_productivity_per_hour = 1,
            productivity_mode_rule = ${demand.productivity_mode_rule ?? 'Hour Based'},
            recommendation_status = 'Draft',
            is_manual_edit = true,
            override_reason = ${dto.reason ?? null},
            edited_by = ${dto.changedBy ?? 'system'},
            edited_at = now()
          where project_id = ${projectId}
            and recommendation_id = cast(${recommendationId} as uuid)
          returning assigned_area, required_hours
        `;

        await this.logAssignmentChange(tx, {
          projectId,
          runId: dto.runId,
          recommendationId,
          fieldChanged: 'hour_based_add',
          oldValue: 'Available',
          newValue: `Added hours: ${hoursToAssign}`,
          reason: dto.reason ?? null,
          changedBy: dto.changedBy ?? 'system',
          approvalRequired: false,
        });

        return;
      }

      const existingActiveRows = await tx.$queryRaw<any[]>`
        select recommendation_id
        from indr.recommended_assignment
        where project_id = ${projectId}
          and run_id = cast(${dto.runId} as uuid)
          and demand_id = cast(${demandId} as uuid)
          and indr.norm_text(coalesce(recommendation_status, 'Draft')) not in (
            'REMOVED',
            'CANCELLED'
          )
        order by created_at asc nulls last, recommendation_id asc
        limit 1
      `;

      let recommendationId: string;

      if (existingActiveRows.length > 0) {
        recommendationId = existingActiveRows[0].recommendation_id;
      } else {
        const inserted = await tx.$queryRaw<any[]>`
          insert into indr.recommended_assignment (
            project_id,
            run_id,
            demand_id,
            block,
            application,
            flat,
            layer_id,
            layer_name,
            surface_type,
            assigned_area,
            required_hours,
            assignment_type,
            recommendation_reason,
            warning_status,
            machine_or_manual,
            selected_productivity_per_hour,
            productivity_mode_rule,
            painter_count,
            recommendation_status,
            is_manual_edit,
            override_reason,
            created_by,
            created_at,
            edited_by,
            edited_at
          )
          values (
            ${projectId},
            cast(${dto.runId} as uuid),
            cast(${demandId} as uuid),
            ${demand.block ?? null},
            ${demand.application},
            ${demand.flat},
            ${demand.layer_id},
            ${demand.layer_name},
            ${demand.surface_type ?? null},
            0,
            0,
            ${isPartial ? 'Partial wall selection' : 'Full'},
            ${dto.reason ?? (isPartial ? 'Partial wall selection from recommendation workspace' : 'Added from work demand workspace')},
            case
              when indr.norm_text(${demand.eligibility_status ?? null}) = 'MISSING PRODUCTIVITY'
              then 'Missing Productivity'
              else null
            end,
            ${demand.machine_or_manual ?? 'Both'},
            coalesce(${productivity}::numeric, 0),
            ${demand.productivity_mode_rule ?? null},
            0,
            'Draft',
            true,
            ${dto.reason ?? null},
            ${dto.changedBy ?? 'system'},
            now(),
            ${dto.changedBy ?? 'system'},
            now()
          )
          returning recommendation_id
        `;

        recommendationId = inserted[0].recommendation_id;
      }

      /*
        Important partial-wall rule:

        - Full Add: add all remaining demand walls that are not already active
          in recommended_assignment_wall for this demand.
        - Partial Add: add only dto.wallNames[].
        - Repeated partial adds merge into the same recommendation row.
          Example: first 2 walls + second 2 walls = same recommendation with 4 walls.
        - Work Demand can then show only the remaining walls because active
          recommended_assignment_wall rows now store the exact selected walls.
      */
      const insertedWalls = await tx.$queryRaw<any[]>`
        insert into indr.recommended_assignment_wall (
          project_id,
          recommendation_id,
          demand_wall_id,
          wall_name,
          wall_area,
          assigned_area,
          remaining_area_after_assignment,
          wall_assignment_status
        )
        select
          ${projectId},
          cast(${recommendationId} as uuid),
          wdw.demand_wall_id,
          wdw.wall_name,
          coalesce(wdw.wall_area, wdw.remaining_area, 0),
          coalesce(wdw.remaining_area, wdw.wall_area, 0),
          0,
          'Selected'
        from indr.work_demand_wall wdw
        where wdw.project_id = ${projectId}
          and wdw.demand_id = cast(${demandId} as uuid)
          and (
            ${isPartial}::boolean = false
            or exists (
              select 1
              from unnest(${selectedWallNames}::text[]) as selected_wall(wall_name)
              where indr.norm_text(selected_wall.wall_name) = indr.norm_text(wdw.wall_name)
            )
          )
          and not exists (
            select 1
            from indr.recommended_assignment_wall raw
            join indr.recommended_assignment ra
              on ra.project_id = raw.project_id
             and ra.recommendation_id = raw.recommendation_id
            where raw.project_id = ${projectId}
              and ra.project_id = ${projectId}
              and ra.run_id = cast(${dto.runId} as uuid)
              and ra.demand_id = cast(${demandId} as uuid)
              and indr.norm_text(coalesce(ra.recommendation_status, 'Draft')) not in (
                'REMOVED',
                'CANCELLED'
              )
              and indr.norm_text(coalesce(raw.wall_assignment_status, 'Selected')) not in (
                'REMOVED',
                'CANCELLED'
              )
              and indr.norm_text(raw.wall_name) = indr.norm_text(wdw.wall_name)
          )
        on conflict (recommendation_id, wall_name)
        do update set
          demand_wall_id = excluded.demand_wall_id,
          wall_area = excluded.wall_area,
          assigned_area = excluded.assigned_area,
          remaining_area_after_assignment = 0,
          wall_assignment_status = 'Selected'
        returning wall_name, assigned_area
      `;

      if (isPartial && insertedWalls.length === 0) {
        throw new BadRequestException(
          'Selected wall(s) are already added in the recommended assignment.',
        );
      }

      const aggregateRows = await tx.$queryRaw<any[]>`
        select
          coalesce(sum(raw.assigned_area), 0)::numeric as assigned_area,
          count(*)::int as selected_wall_count,
          (
            select count(*)::int
            from indr.work_demand_wall wdw
            where wdw.project_id = ${projectId}
              and wdw.demand_id = cast(${demandId} as uuid)
          ) as total_wall_count
        from indr.recommended_assignment_wall raw
        where raw.project_id = ${projectId}
          and raw.recommendation_id = cast(${recommendationId} as uuid)
          and indr.norm_text(coalesce(raw.wall_assignment_status, 'Selected')) not in (
            'REMOVED',
            'CANCELLED'
          )
      `;

      const assignedArea = Number(aggregateRows[0]?.assigned_area ?? 0);
      const selectedWallCount = Number(aggregateRows[0]?.selected_wall_count ?? 0);
      const totalWallCount = Number(aggregateRows[0]?.total_wall_count ?? 0);
      const requiredHours = assignedArea / productivity;
      const assignmentType =
        totalWallCount > 0 && selectedWallCount >= totalWallCount
          ? 'Full'
          : 'Partial wall selection';

      await tx.$executeRaw`
        update indr.recommended_assignment
        set
          assigned_area = ${assignedArea},
          required_hours = ${requiredHours},
          assignment_type = ${assignmentType},
          recommendation_reason = ${assignmentType},
          warning_status = case
            when ${selectedWallCount} < ${totalWallCount}
            then 'Partial Assignment'
            else null
          end,
          machine_or_manual = ${demand.machine_or_manual ?? 'Both'},
          selected_productivity_per_hour = coalesce(${productivity}::numeric, 0),
          productivity_mode_rule = ${demand.productivity_mode_rule ?? null},
          recommendation_status = 'Draft',
          is_manual_edit = true,
          override_reason = ${dto.reason ?? null},
          edited_by = ${dto.changedBy ?? 'system'},
          edited_at = now()
        where project_id = ${projectId}
          and recommendation_id = cast(${recommendationId} as uuid)
      `;

      await this.logAssignmentChange(tx, {
        projectId,
        runId: dto.runId,
        recommendationId,
        fieldChanged: isPartial ? 'partial_wall_add' : 'full_add',
        oldValue: 'Available',
        newValue: isPartial
          ? `Selected walls: ${selectedWallNames.join(', ')}`
          : 'All remaining walls',
        reason: dto.reason ?? null,
        changedBy: dto.changedBy ?? 'system',
        approvalRequired: false,
      });
    });

    return {
      recommendations: await this.getRecommendations(projectId, dto.runId),
      recommendationWalls: await this.getRecommendationWalls(projectId, dto.runId),
    };
  }
  async removeRecommendation(
    projectId: string,
    recommendationId: string,
    dto: RemoveRecommendationDto,
  ) {
    this.assertAssignmentProject(projectId);

    let runId = '';

    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<any[]>`
        select *
        from indr.recommended_assignment
        where project_id = ${projectId}
          and recommendation_id = cast(${recommendationId} as uuid)
        limit 1
      `;

      if (!rows.length) {
        throw new NotFoundException('Recommendation not found');
      }

      const oldRow = rows[0];
      runId = oldRow.run_id;

      await tx.$executeRaw`
        update indr.recommended_assignment
        set
          recommendation_status = 'Removed',
          is_manual_edit = true,
          override_reason = ${dto.reason ?? 'Removed by user'},
          edited_by = ${dto.changedBy ?? 'system'},
          edited_at = now()
        where project_id = ${projectId}
          and recommendation_id = cast(${recommendationId} as uuid)
      `;

      await tx.$executeRaw`
        update indr.recommended_assignment_wall
        set wall_assignment_status = 'Removed'
        where project_id = ${projectId}
          and recommendation_id = cast(${recommendationId} as uuid)
      `;

      await this.logAssignmentChange(tx, {
        projectId,
        runId,
        recommendationId,
        fieldChanged: 'recommendation_status',
        oldValue: oldRow.recommendation_status,
        newValue: 'Removed',
        reason: dto.reason ?? null,
        changedBy: dto.changedBy ?? 'system',
        approvalRequired: false,
      });
    });

    return {
      recommendations: await this.getRecommendations(projectId, runId),
      recommendationWalls: await this.getRecommendationWalls(projectId, runId),
    };
  }
  async restoreRecommendation(
    projectId: string,
    recommendationId: string,
    dto: RemoveRecommendationDto,
  ) {
    this.assertAssignmentProject(projectId);

    let runId = '';

    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<any[]>`
        select *
        from indr.recommended_assignment
        where project_id = ${projectId}
          and recommendation_id = cast(${recommendationId} as uuid)
        limit 1
      `;

      if (!rows.length) {
        throw new NotFoundException('Recommendation not found');
      }

      const oldRow = rows[0];
      runId = oldRow.run_id;

      await tx.$executeRaw`
        update indr.recommended_assignment
        set
          recommendation_status = 'Draft',
          is_manual_edit = true,
          override_reason = ${dto.reason ?? 'Restored by user'},
          edited_by = ${dto.changedBy ?? 'system'},
          edited_at = now()
        where project_id = ${projectId}
          and recommendation_id = cast(${recommendationId} as uuid)
      `;

      await tx.$executeRaw`
        update indr.recommended_assignment_wall
        set wall_assignment_status = 'Selected'
        where project_id = ${projectId}
          and recommendation_id = cast(${recommendationId} as uuid)
          and wall_assignment_status = 'Removed'
      `;

      await this.logAssignmentChange(tx, {
        projectId,
        runId,
        recommendationId,
        fieldChanged: 'recommendation_status',
        oldValue: oldRow.recommendation_status,
        newValue: 'Draft',
        reason: dto.reason ?? null,
        changedBy: dto.changedBy ?? 'system',
        approvalRequired: false,
      });
    });

    return {
      recommendations: await this.getRecommendations(projectId, runId),
      recommendationWalls: await this.getRecommendationWalls(projectId, runId),
    };
  }
  async updateRecommendationPainters(
    projectId: string,
    recommendationId: string,
    dto: UpdateRecommendationPaintersDto,
  ) {
    this.assertAssignmentProject(projectId);

    let runId = '';

    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<any[]>`
        select *
        from indr.recommended_assignment
        where project_id = ${projectId}
          and recommendation_id = cast(${recommendationId} as uuid)
        limit 1
      `;

      if (!rows.length) {
        throw new NotFoundException('Recommendation not found');
      }

      const oldRow = rows[0];
      runId = oldRow.run_id;

      await tx.$executeRaw`
        update indr.recommended_assignment
        set
          assigned_painter_names = ${dto.painterNames}::text[],
          assigned_painter_ids = ${dto.painterIds ?? []}::text[],
          painter_count = ${dto.painterNames.length},
          is_manual_edit = true,
          edited_by = ${dto.changedBy ?? 'system'},
          edited_at = now()
        where project_id = ${projectId}
          and recommendation_id = cast(${recommendationId} as uuid)
      `;

      await this.logAssignmentChange(tx, {
        projectId,
        runId,
        recommendationId,
        fieldChanged: 'assigned_painter_names',
        oldValue: JSON.stringify(oldRow.assigned_painter_names ?? []),
        newValue: JSON.stringify(dto.painterNames),
        reason: dto.reason ?? null,
        changedBy: dto.changedBy ?? 'system',
        approvalRequired: false,
      });
    });

    return {
      recommendations: await this.getRecommendations(projectId, runId),
      recommendationWalls: await this.getRecommendationWalls(projectId, runId),
    };
  }


  async getReportedBackendRows(projectId: string, workDate: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select
        id,
        project_id,
        assignment_id,
        layer_id,
        block,
        application,
        flat,
        work_layer,
        work_date,
        wall_names,
        area,
        painter_names,
        machine_or_manual,
        working_hours,
        work_status,
        material_name,
        material_used_l_kg,
        remark,
        created_at
      from indr.backend
      where project_id = ${projectId}
        and work_date = cast(${workDate} as date)
        and indr.norm_text(work_status) = 'DONE'
      order by created_at desc, application, flat, work_layer
    `;

    return this.normalizeRows(rows);
  }

  async updateReportedBackendRow(
    projectId: string,
    backendId: string,
    dto: UpdateReportedBackendRowDto,
  ) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select *
      from indr.assignment_update_backend_reporting_row(
        ${projectId},
        ${backendId},
        ${dto.wallNames ?? []}::text[],
        ${dto.painterNames}::text[],
        ${dto.machineOrManual},
        ${dto.workingHours},
        ${dto.materialName ?? null},
        ${dto.materialUsedLKg ?? 0},
        ${dto.remark ?? null},
        ${dto.changedBy ?? 'system'}
      )
    `;

    if (!rows.length) {
      throw new NotFoundException('Reported backend row not found');
    }

    await this.syncStoredHourBasedWkdpct(projectId, [rows[0]?.layer_id]);

    return this.normalizeRow(rows[0]);
  }
  async getAssignedRowsByDate(projectId: string, assignmentDate: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select
        project_id,
        assignment_id,
        run_id,
        assignment_date,
        block,
        application,
        flat,
        layer_id,
        layer_name,
        surface_type,
        machine_or_manual,
        assignment_status,
        wall_names,
        wall_count,
        assigned_area,
        productivity_per_hour,
        expected_hours
      from indr.assignment_v_assigned_by_date
      where project_id = ${projectId}
        and assignment_date = cast(${assignmentDate} as date)
      order by application, flat, layer_name, surface_type
    `;

    return this.normalizeRows(rows);
  }
  async getLayerProgressTree(projectId: string) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      select
        project_id,
        layer_id,
        block,
        application,
        flat,
        layer_name,
        layer_order,
        wkdpct,
        flat_sort,
        no_order_flag,
        is_hour_based,
        total_hours,
        reported_hours,
        remaining_hours
      from indr.assignment_v_layer_progress_tree
      where project_id = ${projectId}
      order by
        application,
        flat_sort,
        flat,
        no_order_flag,
        layer_order,
        layer_name
    `;

    return this.normalizeRows(rows);
  }
  async getLayerProgressDetails(
    projectId: string,
    params: {
      application: string;
      flat: string;
      layerId: string;
      layerName: string;
    },
  ) {
    this.assertAssignmentProject(projectId);

    const rows = await this.prisma.$queryRaw<any[]>`
      with input_params as (
        select
          ${projectId}::text as project_id,
          ${params.application}::text as application,
          ${params.flat}::text as flat,
          ${params.layerId}::text as layer_id,
          ${params.layerName}::text as layer_name,
          regexp_replace(${params.flat}::text, '\\D', '', 'g') as flat_digits
      ),

      reported as (
        select
          b.id::text as id,
          'Reported'::text as source_type,
          b.work_date::date as date,
          b.application::text as application,
          b.flat::text as flat,
          b.work_layer::text as layer,
          coalesce(b.wall_names, '-')::text as walls,
          coalesce(b.area, 0)::numeric as area,
          coalesce(b.painter_names, '-')::text as painters,
          coalesce(b.working_hours, 0)::numeric as hours,
          coalesce(b.work_status, '-')::text as work_status
        from indr.backend b
        cross join input_params p
        where b.project_id = p.project_id
          and indr.norm_text(b.application) = indr.norm_text(p.application)
          and (
            indr.norm_text(b.flat) = indr.norm_text(p.flat)
            or regexp_replace(coalesce(b.flat, ''), '\\D', '', 'g') = p.flat_digits
          )
          and (
            indr.norm_text(coalesce(b.layer_id, '')) = indr.norm_text(p.layer_id)
            or indr.norm_text(coalesce(b.work_layer, '')) = indr.norm_text(p.layer_name)
          )
          and indr.norm_text(coalesce(b.work_status, '')) = 'DONE'
      ),

      rollover as (
        select
          min(r.source_id::text) as id,
          'Rollover'::text as source_type,
          min(r.oldest_date)::date as date,
          r.application::text as application,
          r.flat::text as flat,
          r.layer_name::text as layer,

          string_agg(
            distinct coalesce(r.wall_name, '-'),
            ', '
            order by coalesce(r.wall_name, '-')
          )::text as walls,

          sum(coalesce(r.remaining_area, 0))::numeric as area,

          '-'::text as painters,
          0::numeric as hours,
          'Rollover'::text as work_status

        from indr.assignment_v_rollover r
        cross join input_params p
        where r.project_id = p.project_id
          and indr.norm_text(r.application) = indr.norm_text(p.application)
          and (
            indr.norm_text(r.flat) = indr.norm_text(p.flat)
            or regexp_replace(coalesce(r.flat, ''), '\\D', '', 'g') = p.flat_digits
          )
          and (
            indr.norm_text(coalesce(r.layer_id, '')) = indr.norm_text(p.layer_id)
            or indr.norm_text(coalesce(r.layer_name, '')) = indr.norm_text(p.layer_name)
          )
        group by
          r.project_id,
          r.source_id,
          r.application,
          r.flat,
          r.layer_id,
          r.layer_name
      ),

      combined as (
        select * from rollover
        union all
        select * from reported
      )

      select
        id,
        source_type,
        date,
        application,
        flat,
        layer,
        walls,
        area,
        painters,
        hours,
        work_status
      from combined
      order by
        case when source_type = 'Rollover' then 1 else 2 end,
        date desc nulls last,
        id;
    `;

    return this.normalizeRows(rows);
  }


  async getPendingAssignedRowsByDate(
    projectId: string,
    assignmentDate: string,
  ) {
    this.assertAssignmentProject(projectId);

    // Same material enrichment as getTodayAssignedReporting().
    // This is the endpoint used by the Assigned Work table after selecting
    // an assignment date, so material name/quantity must be present here too.
    const rows = await this.prisma.$queryRaw<any[]>`
      with latest_material as (
        select distinct on (
          indr.norm_text(material_option.application),
          indr.norm_text(material_option.layer_name)
        )
          material_option.project_id,
          material_option.application,
          material_option.layer_name,
          material_option.material_name,
          material_option.coverage
        from indr.assignment_v_reporting_material_options material_option
        where material_option.project_id = ${projectId}
        order by
          indr.norm_text(material_option.application),
          indr.norm_text(material_option.layer_name),
          material_option.updated_at desc
      )
      select
        assigned.*,
        material.material_name,
        material.coverage as material_coverage,
        case
          when indr.assignment_is_hour_based_layer(assigned.layer_name)
            or indr.assignment_is_helper_work_layer(assigned.layer_name)
          then 0::numeric
          when coalesce(material.coverage, 0) > 0
          then round(
            coalesce(assigned.pending_area, assigned.assigned_area, 0)::numeric
            / nullif(material.coverage, 0)::numeric,
            2
          )
          else 0::numeric
        end as material_used_l_kg
      from indr.assignment_v_reporting_today_assigned assigned
      left join latest_material material
        on material.project_id = assigned.project_id
       and indr.norm_text(material.application)
           = indr.norm_text(assigned.application)
       and indr.norm_text(material.layer_name)
           = indr.norm_text(assigned.layer_name)
      where assigned.project_id = ${projectId}
        and assigned.assignment_date = cast(${assignmentDate} as date)
      order by
        assigned.application,
        assigned.flat,
        assigned.layer_name,
        assigned.surface_type
    `;

    return this.normalizeRows(rows);
  }


}