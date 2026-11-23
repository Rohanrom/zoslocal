'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ClientWorkApprovalOption,
  ClientWorkApprovalRecord,
  ClientWorkApprovalState,
  SubmitClientWorkApprovalItem,
  fetchClientWorkApproval,
  submitClientWorkApproval,
} from '../../lib/api';

type SelectionSource = 'flat' | 'floor';

type FloorGroup = {
  floor: string;
  flats: ClientWorkApprovalOption[];
};

type ApplicationGroup = {
  application: string;
  floors: FloorGroup[];
};

type BlockGroup = {
  block: string;
  applications: ApplicationGroup[];
};

function approvalKey(value: {
  block: string;
  application: string;
  flat: string;
}) {
  return [value.block, value.application, value.flat]
    .map((part) => String(part || '').trim().toLowerCase())
    .join('||');
}

function floorKey(block: string, application: string, floor: string) {
  return `${block}||${application}||${floor}`.toLowerCase();
}

function applicationKey(block: string, application: string) {
  return `${block}||${application}`.toLowerCase();
}

function ordinal(value: number) {
  const remainder100 = value % 100;
  const remainder10 = value % 10;

  if (remainder100 >= 11 && remainder100 <= 13) return `${value}th`;
  if (remainder10 === 1) return `${value}st`;
  if (remainder10 === 2) return `${value}nd`;
  if (remainder10 === 3) return `${value}rd`;
  return `${value}th`;
}

function floorLabel(floor: string) {
  if (floor === '00') return 'Ground Floor';
  if (floor === 'UNKNOWN') return 'Other / Unmapped Floor';

  const parsed = Number(floor);
  if (!Number.isFinite(parsed)) return `Floor ${floor}`;
  return `${ordinal(parsed)} Floor`;
}

function sortFloors(a: string, b: string) {
  if (a === 'UNKNOWN') return 1;
  if (b === 'UNKNOWN') return -1;

  const aNumber = Number(a);
  const bNumber = Number(b);

  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
    return aNumber - bNumber;
  }

  return a.localeCompare(b, undefined, { numeric: true });
}

function countApproved(
  options: ClientWorkApprovalOption[],
  approvedKeys: Set<string>,
) {
  return options.reduce(
    (count, option) => count + (approvedKeys.has(approvalKey(option)) ? 1 : 0),
    0,
  );
}

export default function WorkApprovalPanel({ token }: { token: string }) {
  const [state, setState] = useState<ClientWorkApprovalState>({
    options: [],
    approvals: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [search, setSearch] = useState('');
  const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>(
    {},
  );
  const [expandedApplications, setExpandedApplications] = useState<
    Record<string, boolean>
  >({});
  const [expandedFloors, setExpandedFloors] = useState<Record<string, boolean>>(
    {},
  );
  const [selectedSources, setSelectedSources] = useState<
    Record<string, SelectionSource>
  >({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');

      try {
        const result = await fetchClientWorkApproval(token);
        if (!cancelled) setState(result);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load work approval options',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const approvedKeys = useMemo(
    () => new Set(state.approvals.map((approval) => approvalKey(approval))),
    [state.approvals],
  );

  const approvedByKey = useMemo(
    () =>
      new Map(
        state.approvals.map((approval) => [approvalKey(approval), approval]),
      ),
    [state.approvals],
  );

  const optionByKey = useMemo(
    () => new Map(state.options.map((option) => [approvalKey(option), option])),
    [state.options],
  );

  const hierarchy = useMemo<BlockGroup[]>(() => {
    const blockMap = new Map<
      string,
      Map<string, Map<string, ClientWorkApprovalOption[]>>
    >();

    state.options.forEach((option) => {
      let applicationMap = blockMap.get(option.block);
      if (!applicationMap) {
        applicationMap = new Map();
        blockMap.set(option.block, applicationMap);
      }

      let floorMap = applicationMap.get(option.application);
      if (!floorMap) {
        floorMap = new Map();
        applicationMap.set(option.application, floorMap);
      }

      const flats = floorMap.get(option.floor) || [];
      flats.push(option);
      floorMap.set(option.floor, flats);
    });

    return Array.from(blockMap.entries())
      .map(([block, applicationMap]) => ({
        block,
        applications: Array.from(applicationMap.entries())
          .map(([application, floorMap]) => ({
            application,
            floors: Array.from(floorMap.entries())
              .map(([floor, flats]) => ({
                floor,
                flats: [...flats].sort((a, b) =>
                  a.flat.localeCompare(b.flat, undefined, {
                    numeric: true,
                    sensitivity: 'base',
                  }),
                ),
              }))
              .sort((a, b) => sortFloors(a.floor, b.floor)),
          }))
          .sort((a, b) =>
            a.application.localeCompare(b.application, undefined, {
              numeric: true,
              sensitivity: 'base',
            }),
          ),
      }))
      .sort((a, b) =>
        a.block.localeCompare(b.block, undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      );
  }, [state.options]);

  const filteredHierarchy = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return hierarchy;

    return hierarchy
      .map((block) => ({
        ...block,
        applications: block.applications
          .map((application) => ({
            ...application,
            floors: application.floors
              .map((floor) => ({
                ...floor,
                flats: floor.flats.filter((flat) =>
                  [block.block, application.application, floorLabel(floor.floor), flat.flat]
                    .join(' ')
                    .toLowerCase()
                    .includes(query),
                ),
              }))
              .filter((floor) => floor.flats.length > 0),
          }))
          .filter((application) => application.floors.length > 0),
      }))
      .filter((block) => block.applications.length > 0);
  }, [hierarchy, search]);

  const selectedItems = useMemo(() => {
    return Object.entries(selectedSources)
      .map(([key, source]) => {
        const option = optionByKey.get(key);
        return option ? { ...option, source } : null;
      })
      .filter(
        (
          value,
        ): value is ClientWorkApprovalOption & { source: SelectionSource } =>
          Boolean(value),
      )
      .sort((a, b) => {
        const blockCompare = a.block.localeCompare(b.block, undefined, {
          numeric: true,
        });
        if (blockCompare !== 0) return blockCompare;

        const applicationCompare = a.application.localeCompare(
          b.application,
          undefined,
          { numeric: true },
        );
        if (applicationCompare !== 0) return applicationCompare;

        return a.flat.localeCompare(b.flat, undefined, { numeric: true });
      });
  }, [optionByKey, selectedSources]);

  const confirmationGroups = useMemo(() => {
    const groups = new Map<string, ClientWorkApprovalOption[]>();

    selectedItems.forEach((item) => {
      const key = `${item.block}||${item.application}||${item.floor}`;
      const items = groups.get(key) || [];
      items.push(item);
      groups.set(key, items);
    });

    return Array.from(groups.entries()).map(([key, items]) => {
      const [block, application, floor] = key.split('||');
      return { block, application, floor, items };
    });
  }, [selectedItems]);

  function toggleBlock(block: string) {
    setExpandedBlocks((current) => ({
      ...current,
      [block]: !current[block],
    }));
  }

  function toggleApplication(block: string, application: string) {
    const key = applicationKey(block, application);
    setExpandedApplications((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function toggleFloorExpansion(block: string, application: string, floor: string) {
    const key = floorKey(block, application, floor);
    setExpandedFloors((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function toggleFlat(option: ClientWorkApprovalOption) {
    const key = approvalKey(option);
    if (approvedKeys.has(key)) return;

    setSuccessMessage('');
    setSelectedSources((current) => {
      const next = { ...current };

      if (next[key]) {
        delete next[key];
      } else {
        next[key] = 'flat';
      }

      return next;
    });
  }

  function toggleFloorSelection(
    block: string,
    application: string,
    floor: FloorGroup,
  ) {
    const pendingFlats = floor.flats.filter(
      (flat) => !approvedKeys.has(approvalKey(flat)),
    );

    if (pendingFlats.length === 0) return;

    const allSelected = pendingFlats.every(
      (flat) => Boolean(selectedSources[approvalKey(flat)]),
    );

    setSuccessMessage('');

    // Keep the floor open after selection so the client can immediately
    // untick any specific flats they do not want to approve.
    setExpandedFloors((current) => ({
      ...current,
      [floorKey(block, application, floor.floor)]: true,
    }));

    setSelectedSources((current) => {
      const next = { ...current };

      pendingFlats.forEach((flat) => {
        const key = approvalKey(flat);

        if (allSelected) {
          delete next[key];
        } else {
          next[key] = 'floor';
        }
      });

      return next;
    });
  }

  async function confirmApproval() {
    if (selectedItems.length === 0 || submitting) return;

    setSubmitting(true);
    setError('');
    setSuccessMessage('');

    const payload: SubmitClientWorkApprovalItem[] = selectedItems.map(
      (item) => ({
        block: item.block,
        application: item.application,
        flat: item.flat,
        source: item.source,
      }),
    );

    try {
      const result = await submitClientWorkApproval(token, payload);
      setState({
        options: result.options,
        approvals: result.approvals,
      });
      setSelectedSources({});
      setConfirmOpen(false);
      setSuccessMessage(result.message || 'Work approval submitted successfully.');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to submit work approval',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const totalApproved = approvedKeys.size;
  const totalOptions = state.options.length;

  if (loading) {
    return (
      <div>
        <div className="mb-5">
          <h1 className="font-display text-2xl font-bold">Work Approval</h1>
          <p className="mt-1 text-sm text-slate-500">
            Loading approval hierarchy...
          </p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
          Loading flats...
        </div>
      </div>
    );
  }

  return (
    <div className="pb-28">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Work Approval</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Approve permanent work access application-wise. Approved flats stay
            visible in green and cannot be withdrawn from the Client Portal.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-right">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            Project Approval
          </p>
          <p className="mt-1 font-mono text-sm font-semibold text-emerald-300">
            {totalApproved} / {totalOptions} flats approved
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          {successMessage}
        </div>
      )}

      <div className="mb-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              How to select
            </p>
            <p className="mt-2 text-sm text-slate-300">
              Select a floor to select all pending flats under it, then untick any
              individual flats you do not want to approve. You can also select
              individual flats directly.
            </p>
          </div>

          <div className="w-full lg:max-w-md">
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">
              Find Work Area
            </label>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search block, application, floor or flat"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-400"
            />
          </div>
        </div>
      </div>

      {filteredHierarchy.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-500">
          No flats match the current search.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredHierarchy.map((block) => {
            const blockFlats = block.applications.flatMap((application) =>
              application.floors.flatMap((floor) => floor.flats),
            );
            const blockApproved = countApproved(blockFlats, approvedKeys);
            const blockComplete =
              blockFlats.length > 0 && blockApproved === blockFlats.length;
            const blockOpen = search.trim()
              ? true
              : Boolean(expandedBlocks[block.block]);

            return (
              <section
                key={block.block}
                className={`overflow-hidden rounded-2xl border bg-slate-900 ${
                  blockComplete
                    ? 'border-emerald-500/30'
                    : 'border-slate-800'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleBlock(block.block)}
                  className={`flex w-full items-center gap-3 px-4 py-4 text-left transition ${
                    blockComplete
                      ? 'bg-emerald-500/5 hover:bg-emerald-500/10'
                      : 'hover:bg-slate-800/70'
                  }`}
                >
                  <span className={`text-xs text-slate-500 ${blockOpen ? 'rotate-90' : ''}`}>
                    ▸
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-base font-semibold text-slate-100">
                        {block.block}
                      </h2>
                      {blockComplete && (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                          Approved
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {block.applications.length} applications · {blockApproved}/{blockFlats.length} flats approved
                    </p>
                  </div>
                </button>

                {blockOpen && (
                  <div className="border-t border-slate-800 p-3 md:p-4">
                    <div className="space-y-3">
                      {block.applications.map((application) => {
                        const applicationFlats = application.floors.flatMap(
                          (floor) => floor.flats,
                        );
                        const applicationApproved = countApproved(
                          applicationFlats,
                          approvedKeys,
                        );
                        const applicationComplete =
                          applicationFlats.length > 0 &&
                          applicationApproved === applicationFlats.length;
                        const appKey = applicationKey(
                          block.block,
                          application.application,
                        );
                        const appOpen = search.trim()
                          ? true
                          : Boolean(expandedApplications[appKey]);

                        return (
                          <div
                            key={application.application}
                            className={`rounded-xl border ${
                              applicationComplete
                                ? 'border-emerald-500/25 bg-emerald-500/[0.04]'
                                : 'border-slate-800 bg-slate-950/45'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                toggleApplication(
                                  block.block,
                                  application.application,
                                )
                              }
                              className="flex w-full items-center gap-3 px-4 py-3 text-left"
                            >
                              <span className={`text-[10px] text-slate-500 ${appOpen ? 'rotate-90' : ''}`}>
                                ▸
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold text-slate-200">
                                    {application.application}
                                  </p>
                                  {applicationComplete && (
                                    <span className="text-[10px] font-semibold text-emerald-300">
                                      ✓ Approved
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 text-[10px] text-slate-500">
                                  {application.floors.length} floors · {applicationApproved}/{applicationFlats.length} flats approved
                                </p>
                              </div>
                            </button>

                            {appOpen && (
                              <div className="space-y-2 border-t border-slate-800 p-3">
                                {application.floors.map((floor) => {
                                  const floorApproved = countApproved(
                                    floor.flats,
                                    approvedKeys,
                                  );
                                  const floorComplete =
                                    floor.flats.length > 0 &&
                                    floorApproved === floor.flats.length;
                                  const pendingFlats = floor.flats.filter(
                                    (flat) =>
                                      !approvedKeys.has(approvalKey(flat)),
                                  );
                                  const selectedPending = pendingFlats.filter(
                                    (flat) =>
                                      Boolean(
                                        selectedSources[approvalKey(flat)],
                                      ),
                                  ).length;
                                  const allPendingSelected =
                                    pendingFlats.length > 0 &&
                                    selectedPending === pendingFlats.length;
                                  const thisFloorKey = floorKey(
                                    block.block,
                                    application.application,
                                    floor.floor,
                                  );
                                  const floorOpen = search.trim()
                                    ? true
                                    : Boolean(expandedFloors[thisFloorKey]);

                                  return (
                                    <div
                                      key={floor.floor}
                                      className={`overflow-hidden rounded-xl border ${
                                        floorComplete
                                          ? 'border-emerald-500/30 bg-emerald-500/[0.06]'
                                          : allPendingSelected
                                            ? 'border-cyan-500/40 bg-cyan-500/[0.05]'
                                            : 'border-slate-800 bg-slate-950/60'
                                      }`}
                                    >
                                      <div className="flex items-center gap-3 p-3">
                                        <input
                                          type="checkbox"
                                          checked={
                                            floorComplete ||
                                            allPendingSelected
                                          }
                                          disabled={floorComplete}
                                          onChange={() =>
                                            toggleFloorSelection(
                                              block.block,
                                              application.application,
                                              floor,
                                            )
                                          }
                                          title={
                                            floorComplete
                                              ? 'All flats on this floor are already approved'
                                              : allPendingSelected
                                                ? 'Untick to clear the pending flats selected on this floor'
                                                : 'Tick to select all pending flats on this floor'
                                          }
                                          className="h-4 w-4 accent-cyan-500 disabled:accent-emerald-500"
                                        />

                                        <button
                                          type="button"
                                          onClick={() =>
                                            toggleFloorExpansion(
                                              block.block,
                                              application.application,
                                              floor.floor,
                                            )
                                          }
                                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                        >
                                          <span className={`text-[10px] text-slate-500 ${floorOpen ? 'rotate-90' : ''}`}>
                                            ▸
                                          </span>
                                          <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                              <p className={`text-sm font-semibold ${floorComplete ? 'text-emerald-300' : 'text-slate-200'}`}>
                                                {floorLabel(floor.floor)}
                                              </p>
                                              {floorComplete && (
                                                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                                                  ✓ Approved
                                                </span>
                                              )}
                                            </div>
                                            <p className="mt-1 text-[10px] text-slate-500">
                                              {floorApproved}/{floor.flats.length} approved
                                              {selectedPending > 0
                                                ? ` · ${selectedPending} selected`
                                                : ''}
                                            </p>
                                          </div>
                                        </button>
                                      </div>

                                      {floorOpen && (
                                        <div className="grid grid-cols-1 gap-2 border-t border-slate-800 p-3 sm:grid-cols-2 xl:grid-cols-4">
                                          {floor.flats.map((flat) => {
                                            const key = approvalKey(flat);
                                            const approved = approvedKeys.has(key);
                                            const selected = Boolean(
                                              selectedSources[key],
                                            );
                                            const approval = approvedByKey.get(key);

                                            return (
                                              <label
                                                key={flat.flat}
                                                className={`flex min-h-[64px] items-start gap-3 rounded-xl border p-3 transition ${
                                                  approved
                                                    ? 'cursor-default border-emerald-500/30 bg-emerald-500/10'
                                                    : selected
                                                      ? 'cursor-pointer border-cyan-500/50 bg-cyan-500/10'
                                                      : 'cursor-pointer border-slate-700 bg-slate-900 hover:border-slate-600'
                                                }`}
                                              >
                                                {!approved ? (
                                                  <input
                                                    type="checkbox"
                                                    checked={selected}
                                                    onChange={() =>
                                                      toggleFlat(flat)
                                                    }
                                                    className="mt-0.5 h-4 w-4 accent-cyan-500"
                                                  />
                                                ) : (
                                                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-slate-950">
                                                    ✓
                                                  </span>
                                                )}

                                                <div className="min-w-0">
                                                  <p className={`text-xs font-semibold ${approved ? 'text-emerald-200' : selected ? 'text-cyan-200' : 'text-slate-200'}`}>
                                                    {flat.flat}
                                                  </p>
                                                  <p className="mt-1 text-[10px] text-slate-500">
                                                    {approved
                                                      ? `Approved${approval?.approvedBy ? ` by ${approval.approvedBy}` : ''}`
                                                      : selected
                                                        ? 'Selected for approval'
                                                        : 'Pending approval'}
                                                  </p>
                                                </div>
                                              </label>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {selectedItems.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-700 bg-slate-900/95 p-3 shadow-2xl backdrop-blur md:left-60">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">
                {selectedItems.length} flat{selectedItems.length === 1 ? '' : 's'} selected
              </p>
              <p className="text-[11px] text-slate-500">
                Nothing is saved until you review and confirm.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSelectedSources({})}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Clear Selection
              </button>
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
              >
                Review & Submit ({selectedItems.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="border-b border-slate-800 p-5">
              <h2 className="font-display text-xl font-bold">Confirm Work Approval</h2>
              <p className="mt-1 text-sm text-slate-500">
                Please verify the selected flats before submitting.
              </p>
            </div>

            <div className="max-h-[55vh] space-y-3 overflow-y-auto p-5">
              {confirmationGroups.map((group) => (
                <div
                  key={`${group.block}-${group.application}-${group.floor}`}
                  className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-slate-200">
                        {group.block} · {group.application}
                      </p>
                      <p className="mt-1 text-[11px] text-cyan-300">
                        {floorLabel(group.floor)}
                      </p>
                    </div>
                    <span className="rounded-full border border-slate-700 px-2 py-1 text-[10px] text-slate-400">
                      {group.items.length} flats
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {group.items.map((item) => (
                      <span
                        key={item.flat}
                        className="rounded-lg bg-slate-800 px-2 py-1 text-[11px] text-slate-300"
                      >
                        {item.flat}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-800 p-5">
              <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-200">
                You are approving <strong>{selectedItems.length}</strong> flat{selectedItems.length === 1 ? '' : 's'}. This approval is permanent and cannot be withdrawn from the Client Portal.
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setConfirmOpen(false)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void confirmApproval()}
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : 'Confirm Approval'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}