"use client";
import { useReportingPeriodContext } from "@/context/ReportingPeriodContext";
import { useEffect, useState } from "react";
import { getCampuses, getBuildings, getFloors } from "@/lib/api";

import { useDashboardContext } from "@/hooks/useDashboardContext";

export default function DashboardFilterBar() {
  const { filters, setFilters, periods } = useDashboardContext();
  const { activePeriodId, setActivePeriodId } = useReportingPeriodContext();
  const [locations, setLocations] = useState<{ campuses: any[]; buildings: any[]; floors: any[] }>({ campuses: [], buildings: [], floors: [] });
  useEffect(() => {
    let cancelled = false;
    Promise.all([getCampuses(), getBuildings(), getFloors()]).then(([c, b, f]) => {
      if (!cancelled) setLocations({ campuses: c.data || [], buildings: b.data || [], floors: f.data || [] });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const periodOptions: { id: string; name: string }[] = (periods || []).map((rp: any) => ({
    id: rp.id,
    name: rp.name,
  }));

  return (
    <div className="flex flex-wrap items-center gap-[12px] rounded-[20px] border border-white/60 bg-white/70 backdrop-blur-2xl p-[16px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-[24px]">
      <div className="flex items-center gap-[8px] pl-[8px]">
        <span className="text-[12px] font-semibold text-[#71717a] uppercase tracking-wide">Filters</span>
      </div>

      <div className="h-[24px] w-[1px] bg-slate-200 mx-[4px]"></div>

      {/* Reporting Period — functional; drives /dashboard/summary */}
      <div className="flex flex-col gap-[4px]">
        <select
          className="rounded-[8px] border border-slate-200 bg-white px-[12px] py-[6px] text-[13px] font-medium text-slate-800 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400"
          value={activePeriodId || ""}
          onChange={(e) => { setActivePeriodId(e.target.value); setFilters((prev: any) => ({ ...prev, reportingPeriodId: "" })); }}
        >
          {!activePeriodId && <option value="">Select a period</option>}
          {periodOptions.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-[12px]">
        <select aria-label="Filter by campus" value={filters.campusId} onChange={e => setFilters((p: any) => ({ ...p, campusId: e.target.value, buildingId: "", floorId: "" }))} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm">
          <option value="">All Campuses</option>{locations.campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="Filter by building" value={filters.buildingId} onChange={e => setFilters((p: any) => ({ ...p, buildingId: e.target.value, floorId: "" }))} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm">
          <option value="">All Buildings</option>{locations.buildings.filter(b => !filters.campusId || b.campusId === filters.campusId).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select aria-label="Filter by floor" value={filters.floorId} onChange={e => setFilters((p: any) => ({ ...p, floorId: e.target.value }))} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm">
          <option value="">All Floors</option>{locations.floors.filter(f => (!filters.buildingId || f.buildingId === filters.buildingId) && (!filters.campusId || f.campusId === filters.campusId)).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

    </div>
  );
}
