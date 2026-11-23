import { createClient } from 'npm:@supabase/supabase-js@2';

const PROJECT_ID = 'park_heights';
const SCHEMA_NAME = 'indr';
const TABLE_NAME = 'backend';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-zos-sync-secret, x-zos-appsheet-id, x-zos-work-status',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function hasColumn(row: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(row, key);
}

function cleanString(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();
  if (!text) return null;

  const lowered = text.toLowerCase();
  if (lowered === 'null' || lowered === 'undefined') return null;

  return text;
}

function parseNumber(value: unknown, fieldName: string): number | null {
  const text = cleanString(value);

  if (text === null || ['n/a', 'na', '-'].includes(text.toLowerCase())) {
    return null;
  }

  const numberValue = Number(text.replace(/[,\s₹$]/g, ''));

  if (!Number.isFinite(numberValue)) {
    throw new Error(`Invalid numeric value for ${fieldName}: ${text}`);
  }

  return numberValue;
}

function makeIsoDate(year: number, month: number, day: number): string {
  const probe = new Date(Date.UTC(year, month - 1, day));

  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(
      `Invalid AppSheet MM/DD/YYYY date: ${month}/${day}/${year}`,
    );
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(
    2,
    '0',
  )}-${String(day).padStart(2, '0')}`;
}

function parseAppSheetDate(value: unknown): string | null {
  const text = cleanString(value);

  if (text === null || ['n/a', 'na', '-'].includes(text.toLowerCase())) {
    return null;
  }

  // Allow ISO later if AppSheet is changed to emit YYYY-MM-DD.
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return makeIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  // LOCKED CURRENT FORMAT: MM/DD/YYYY.
  const mmddyyyy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mmddyyyy) {
    return makeIsoDate(
      Number(mmddyyyy[3]),
      Number(mmddyyyy[1]),
      Number(mmddyyyy[2]),
    );
  }

  throw new Error(
    `Unsupported AppSheet Date: ${text}. Expected MM/DD/YYYY.`,
  );
}

function getAppSheetId(row: Record<string, unknown>) {
  return (
    cleanString(row['ID']) ||
    cleanString(row['Id']) ||
    cleanString(row['id'])
  );
}

function normalizeWorkStatus(value: unknown): string | null {
  const status = cleanString(value);
  return status ? status.toUpperCase() : null;
}

function isAllowedWorkStatus(status: string | null) {
  return status === 'DONE' || status === 'PENDING';
}

function mapAppSheetRow(
  row: Record<string, unknown>,
  appsheetId: string,
) {

  const now = new Date().toISOString();

  const data: Record<string, unknown> = {
    project_id: PROJECT_ID,
    appsheet_id: appsheetId,
    appsheet_synced_at: now,
    updated_at: now,
  };

  if (hasColumn(row, 'Block')) {
    data.block = cleanString(row['Block']);
  }

  if (hasColumn(row, 'Application')) {
    data.application = cleanString(row['Application']);
  }

  if (hasColumn(row, 'Flat')) {
    data.flat = cleanString(row['Flat']);
  }

  if (hasColumn(row, 'Work Layer')) {
    data.work_layer = cleanString(row['Work Layer']);
  }

  if (hasColumn(row, 'Date')) {
    data.work_date = parseAppSheetDate(row['Date']);
  }

  if (hasColumn(row, 'WALLName')) {
    data.wall_names = cleanString(row['WALLName']);
  }

  if (hasColumn(row, 'Area')) {
    data.area = parseNumber(row['Area'], 'Area') ?? 0;
  }

  if (hasColumn(row, 'Painter Name')) {
    data.painter_names = cleanString(row['Painter Name']);
  }

  if (hasColumn(row, 'Machine or Manual')) {
    data.machine_or_manual = cleanString(row['Machine or Manual']);
  }

  if (hasColumn(row, 'Working Hours')) {
    data.working_hours =
      parseNumber(row['Working Hours'], 'Working Hours') ?? 0;
  }

  if (hasColumn(row, 'Work Status')) {
    data.work_status = cleanString(row['Work Status']);
  }

  if (hasColumn(row, 'Material Name')) {
    data.material_name = cleanString(row['Material Name']);
  }

  if (hasColumn(row, 'Material Used (L/KG)')) {
    data.material_used_l_kg =
      parseNumber(row['Material Used (L/KG)'], 'Material Used (L/KG)') ?? 0;
  }

  if (hasColumn(row, 'Remark')) {
    data.remark = cleanString(row['Remark']);
  }

  if (hasColumn(row, 'LayerID')) {
    data.layer_id = cleanString(row['LayerID']);
  }

  // These are informational only. They never control project_id.
  if (hasColumn(row, 'Site')) {
    data.appsheet_site = cleanString(row['Site']);
  }

  if (hasColumn(row, 'user')) {
    data.appsheet_user = cleanString(row['user']);
  }

  return data;
}

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: corsHeaders,
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
      return jsonResponse(
        { success: false, error: 'Only POST is allowed' },
        405,
      );
    }

    const configuredSecret = Deno.env.get('APPSHEET_BACKEND_SYNC_SECRET');
    const receivedSecret = req.headers.get('x-zos-sync-secret');

    if (!configuredSecret) {
      return jsonResponse(
        {
          success: false,
          error: 'APPSHEET_BACKEND_SYNC_SECRET is not configured',
        },
        500,
      );
    }

    if (!receivedSecret || receivedSecret !== configuredSecret) {
      return jsonResponse(
        { success: false, error: 'Unauthorized' },
        401,
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        {
          success: false,
          error:
            'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is unavailable',
        },
        500,
      );
    }

    let payload: Record<string, unknown>;

    try {
      payload = await req.json();
    } catch {
      return jsonResponse(
        { success: false, error: 'Invalid JSON body' },
        400,
      );
    }

    const action = String(
      payload.action ?? payload.operation ?? 'UPSERT',
    )
      .trim()
      .toUpperCase();

    // Accept:
    //   { action: 'UPSERT', row: {...} }
    // or the AppSheet default row JSON directly.
    const rowCandidate =
      payload.row && typeof payload.row === 'object'
        ? payload.row
        : payload.data && typeof payload.data === 'object'
          ? payload.data
          : payload;

    const row = rowCandidate as Record<string, unknown>;

    // AppSheet's default webhook body excludes Hidden and Show-type columns.
    // If Backend[ID] is hidden, it may therefore be absent from the JSON body.
    // The bot can send the key safely in this header without changing the
    // AppSheet UI or forcing us to hand-build/escape the entire JSON body.
    const headerAppSheetId = cleanString(
      req.headers.get('x-zos-appsheet-id'),
    );

    const appsheetId = getAppSheetId(row) || headerAppSheetId;

    if (!appsheetId) {
      console.error('AppSheet ID missing from webhook request', {
        topLevelKeys: Object.keys(payload),
        rowKeys: Object.keys(row),
      });

      return jsonResponse(
        {
          success: false,
          error:
            'AppSheet Backend[ID] is required. Send x-zos-appsheet-id: <<[ID]>> in the webhook headers.',
        },
        400,
      );
    }

    const headerWorkStatus = cleanString(
      req.headers.get('x-zos-work-status'),
    );
    const workStatus = normalizeWorkStatus(
      hasColumn(row, 'Work Status')
        ? row['Work Status']
        : headerWorkStatus,
    );

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const db = supabase.schema(SCHEMA_NAME);

    if (action === 'DELETE') {
      const { data, error } = await db
        .from(TABLE_NAME)
        .delete()
        .eq('project_id', PROJECT_ID)
        .eq('appsheet_id', appsheetId)
        .select('id, appsheet_id');

      if (error) {
        console.error('DELETE failed', error);
        throw error;
      }

      return jsonResponse({
        success: true,
        project_id: PROJECT_ID,
        action: 'DELETE',
        appsheet_id: appsheetId,
        deleted_rows: data?.length ?? 0,
      });
    }

    if (!['UPSERT', 'ADD', 'UPDATE'].includes(action)) {
      return jsonResponse(
        {
          success: false,
          error: `Unsupported action: ${action}`,
        },
        400,
      );
    }

    // Park Heights sync rule:
    // ONLY Done and Pending rows are allowed to exist in Supabase.
    // If an AppSheet row becomes Assigned (or any other status), remove
    // the corresponding AppSheet-origin row from indr.backend.
    if (!workStatus) {
      return jsonResponse(
        {
          success: false,
          error:
            'Work Status is required for Add/Update. Send x-zos-work-status: <<[Work Status]>> in the webhook headers.',
        },
        400,
      );
    }

    if (!isAllowedWorkStatus(workStatus)) {
      const { data, error } = await db
        .from(TABLE_NAME)
        .delete()
        .eq('project_id', PROJECT_ID)
        .eq('appsheet_id', appsheetId)
        .select('id, appsheet_id');

      if (error) {
        console.error('Status-filter DELETE failed', error);
        throw error;
      }

      return jsonResponse({
        success: true,
        project_id: PROJECT_ID,
        action: 'DELETE_NOT_ELIGIBLE',
        appsheet_id: appsheetId,
        work_status: workStatus,
        deleted_rows: data?.length ?? 0,
      });
    }

    const mapped = mapAppSheetRow(row, appsheetId);
    mapped.work_status = workStatus === 'DONE' ? 'Done' : 'Pending';

    const { data, error } = await db
      .from(TABLE_NAME)
      .upsert(mapped, {
        onConflict: 'project_id,appsheet_id',
      })
      .select('id, appsheet_id, project_id')
      .single();

    if (error) {
      console.error('UPSERT failed', error);
      throw error;
    }

    return jsonResponse({
      success: true,
      project_id: PROJECT_ID,
      action: 'UPSERT',
      appsheet_id: appsheetId,
      backend_id: data.id,
    });
  } catch (error) {
    console.error('Unhandled AppSheet backend sync error', error);

    return jsonResponse(
      {
        success: false,
        project_id: PROJECT_ID,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
