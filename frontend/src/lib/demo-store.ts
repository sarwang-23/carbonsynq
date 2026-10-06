// Browser-only demo data. No database, provider credentials, or production tokens.
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
export const DEMO_EMAIL = "demo@carbonsynq.test";
export const DEMO_PASSWORD = "Demo@2026";
export const DEMO_TOKEN = "carbonsynq-demo-session";
export const DEMO_ORG = "demo-university";
export const DEMO_KEY = "carbonsynq_demo_v1";
export const DEMO_STATE_EVENT = "carbonsynq-workspace-changed";
export type Row = Record<string, any>;
export type DemoState = {
  version: number;
  onboardingCompleted: boolean;
  dataMode: "SAMPLE" | "USER";
  onboarding: Row | null;
  university: Row;
  collections: Record<string, Row[]>;
};

export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
export const round = (n: number, places = 3) => Number(n.toFixed(places));
export const sumKg = (rows: Row[]) => rows.reduce((n, r) => n + (r.calculations?.[0]?.co2eKg ?? 0), 0);

export function makeCalculation(activity: Row, factor: Row): Row {
  const co2eKg = round(Number(activity.quantity) * Number(factor.factor));
  return {
    id: `calc-${activity.id}`, activityDataId: activity.id, co2eKg,
    co2eTonnes: round(co2eKg / 1000), calculatedAt: new Date().toISOString(),
    emissionFactorId: factor.id, emissionFactor: { ...factor, factorValue: factor.factor },
    factorValue: factor.factor, factorUnit: `kgCO2e/${factor.unit}`,
    factorSource: factor.source, factorVersion: factor.version, factorName: factor.name,
    formula: `${activity.quantity} ${activity.unit} × ${factor.factor} = ${co2eKg} kgCO2e`,
    methodology: "Illustrative demo factor; quantity × factor. Not an official inventory.",
  };
}

export function seedDemo(): DemoState {
  const factors = [
    ["PURCHASED_ELECTRICITY", "Grid electricity", "SCOPE_2", "kWh", 0.71],
    ["PURCHASED_STEAM", "Purchased steam", "SCOPE_2", "kg", 0.2],
    ["DIESEL", "Diesel combustion", "SCOPE_1", "L", 2.68],
    ["PETROL", "Petrol combustion", "SCOPE_1", "L", 2.31],
    ["LPG", "LPG combustion", "SCOPE_1", "kg", 3.0],
    ["NATURAL_GAS", "Natural gas combustion", "SCOPE_1", "m3", 2.0],
    ["REFRIGERANT", "Refrigerant leakage (illustrative)", "SCOPE_1", "kg", 1430],
    ["OWNED_VEHICLE", "Owned fleet distance (illustrative)", "SCOPE_1", "km", 0.18],
    ["WATER", "Purchased water (illustrative)", "SCOPE_3", "m3", 0.3],
    ["BUSINESS_TRAVEL", "Travel distance (illustrative)", "SCOPE_3", "km", 0.15],
  ].map(([category, name, scope, unit, factor], i) => ({
    id: `ef-${i + 1}`, category, name, scope, unit, factor, factorValue: factor,
    source: "Illustrative demo dataset", version: "DEMO-2026", country: "India",
    year: 2026, isActive: true, status: "APPROVED",
  }));
  const campuses = [
    { id: "campus-main", name: "Main Campus", code: "MAIN", city: "Pune", country: "India", universityId: DEMO_ORG, areaSqm: 62000 },
    { id: "campus-research", name: "Research Campus", code: "RES", city: "Pune", country: "India", universityId: DEMO_ORG, areaSqm: 28000 },
  ];
  const buildings = [
    { id: "building-academic", name: "Academic Block", code: "ACAD", campusId: "campus-main", buildingType: "Academic", areaSqm: 26000 },
    { id: "building-hostel", name: "Student Residences", code: "HOSTEL", campusId: "campus-main", buildingType: "Hostel", areaSqm: 24000 },
    { id: "building-library", name: "Library & Administration", code: "LIB", campusId: "campus-main", buildingType: "Library", areaSqm: 12000 },
    { id: "building-lab", name: "Research Laboratories", code: "LAB", campusId: "campus-research", buildingType: "Laboratory", areaSqm: 28000 },
  ];
  const floors = buildings.flatMap(b => [0, 1, 2].map(n => ({
    id: `${b.id}-floor-${n}`, buildingId: b.id, campusId: b.campusId,
    name: n === 0 ? "Ground Floor" : `Floor ${n}`, code: n === 0 ? "GF" : `F${n}`,
    floorNumber: n, areaSqm: Math.round(b.areaSqm / 3),
  })));
  const hierarchy = { campuses: campuses.map(c => ({ ...c, buildings: buildings.filter(b => b.campusId === c.id).map(b => ({ ...b, floors: floors.filter(f => f.buildingId === b.id) })) })) };
  const periods = [
    { id: "period-2026", name: "FY 2026–27", year: "2026-27", startDate: "2026-04-01T00:00:00.000Z", endDate: "2027-03-31T23:59:59.999Z", status: "OPEN", isBaseline: false, universityId: DEMO_ORG, createdAt: "2026-04-01T00:00:00.000Z" },
    { id: "period-2025", name: "FY 2025–26", year: "2025-26", startDate: "2025-04-01T00:00:00.000Z", endDate: "2026-03-31T23:59:59.999Z", status: "LOCKED", isBaseline: true, universityId: DEMO_ORG, createdAt: "2025-04-01T00:00:00.000Z" },
  ];
  const activities: Row[] = [];
  for (const period of periods) {
    const count = period.id === "period-2026" ? 6 : 12;
    const year = period.id === "period-2026" ? 2026 : 2025;
    for (let m = 0; m < count; m++) {
      for (const [bIndex, b] of buildings.entries()) {
        for (const cat of ["PURCHASED_ELECTRICITY", "DIESEL", "LPG"]) {
          const factor = factors.find(f => f.category === cat)!;
          const base = cat === "PURCHASED_ELECTRICITY" ? [43000, 35000, 22000, 41000][bIndex] : cat === "DIESEL" ? [1200, 650, 350, 900][bIndex] : [60, 1800, 40, 100][bIndex];
          const seasonal = [1, 1.07, 1.12, 0.98, 0.93, 0.95, 1.01, 1.06, 0.99, 0.92, 0.89, 1.03][m];
          const quantity = Math.round(base * seasonal * (year === 2025 ? 1.15 : 1));
          const date = new Date(Date.UTC(year, m + 3, 15)).toISOString();
          const a: Row = { id: `activity-${year}-${m}-${bIndex}-${cat}`, universityId: DEMO_ORG,
            reportingPeriodId: period.id, category: cat, scope: factor.scope, quantity,
            unit: factor.unit, activityDate: date, createdAt: date, updatedAt: date,
            status: "CALCULATED", inputSource: "MANUAL", dataSource: "Sample monthly ledger",
            description: `${b.name} · ${new Date(date).toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" })}`,
            campusId: b.campusId, buildingId: b.id, floorId: `${b.id}-floor-0`,
            campus: campuses.find(c => c.id === b.campusId), building: b, calculations: [],
          };
          a.calculations = [makeCalculation(a, factor)];
          activities.push(a);
        }
      }
    }
  }
  for (const [i, status] of ["DRAFT", "SUBMITTED", "SUBMITTED", "UNDER_REVIEW", "VERIFIED", "REJECTED"].entries()) {
    activities.unshift({ id: `pending-${i}`, universityId: DEMO_ORG, reportingPeriodId: "period-2026",
      category: i % 2 ? "DIESEL" : "PURCHASED_ELECTRICITY", scope: i % 2 ? "SCOPE_1" : "SCOPE_2",
      quantity: i % 2 ? 1250 : 18500, unit: i % 2 ? "L" : "kWh", activityDate: "2026-10-02T00:00:00.000Z",
      status, inputSource: "MANUAL", description: ["October academic meter reading", "October generator fuel", "Research block meter reading", "Hostel generator fuel", "Verified library electricity", "Duplicate diesel entry — rejected"][i],
      campusId: "campus-main", buildingId: "building-academic", floorId: "building-academic-floor-0",
      createdAt: "2026-10-02T09:00:00.000Z", calculations: [], rejectionReason: status === "REJECTED" ? "Duplicate entry" : null,
    });
  }
  const university = { id: DEMO_ORG, name: "Greenfield University", code: "GFU", country: "India", city: "Pune", studentCount: 12000, staffCount: 1450, areaSqm: 90000 };
  const onboarding = {
    id: "demo-onboarding", organisationId: DEMO_ORG, createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    company: { legalName: university.name, brandName: university.name, registrationNumber: "DEMO", industry: "education", subsector: "higher-education", website: "", orgStructure: "multi", consolidationApproach: "operational-control", employeeCount: "1450", annualRevenue: "", fiscalYearEnd: "March" },
    university: { legalName: university.name, brandName: university.name, ugcId: "DEMO-UNIVERSITY", universityType: "Private", affiliation: "Demo", naacGrade: "", campusCount: "2", studentEnrollment: "12000", staffCount: "1450", website: "", fiscalYearEnd: "March" },
    locations: { facilityCount: "4", countries: ["India"], facilityTypes: ["Campus", "Laboratory", "Hostel"], ownershipStatus: "owned", floorArea: "90000", vehicles: "12", onSiteEnergy: ["diesel", "solar"] },
    reporting: { primaryReason: "internal", frameworks: ["GHG Protocol"], reportingType: "annual", deadline: "2027-06-30", previousReporting: "yes", assurance: "none", audience: ["leadership"] },
    integrations: { erp: "none", accounting: "excel", utilityBilling: "yes", utilityBillingMethod: "manual", fleet: "manual", travel: "manual", procurement: "manual", iot: [], dataInputMethod: "hybrid", centralization: "centralized" },
    emissions: { scope1Fuels: ["diesel", "lpg"], refrigerants: [], electricitySource: "grid", recs: "no", steam: "no" },
    valueChain: { supplierData: "none", spendCategories: [], commuting: "survey", businessTravel: "manual", logisticsOwnership: "", waste: "manual", cloudProviders: [], physicalProducts: "no", franchises: "", leasedAssets: "", investments: "" },
    strategy: { targets: "yes", targetYear: "2030", reduction: "30", commitments: [], carbonCredits: "no", role: "admin", teammateEmails: "", workflows: ["review"], primaryContact: "Demo Administrator", contactEmail: DEMO_EMAIL },
    physicalHierarchy: hierarchy,
  };
  const baselineTotal = sumKg(activities.filter(a => a.reportingPeriodId === "period-2025"));
  const baselines = [{ id: "baseline-2025", universityId: DEMO_ORG, reportingPeriodId: "period-2025", name: "FY 2025–26 baseline", year: 2025, baselineYear: 2025, status: "APPROVED", totalKgCO2e: baselineTotal, totalCo2eKg: baselineTotal, totalEmissionsKg: baselineTotal, reportingPeriod: periods[1], createdAt: "2026-04-01T00:00:00.000Z" }];
  const collections: Record<string, Row[]> = {
    "activity-data": activities, "reporting-periods": periods, campuses, buildings, floors,
    "emission-factors": factors, baselines,
    assets: [{ id: "asset-dg", name: "Main Campus Diesel Generator", type: "GENERATOR", campusId: "campus-main", buildingId: "building-academic", universityId: DEMO_ORG }],
    targets: [{ id: "target-2030", targetYear: 2030, reductionPct: 30, baselineId: "baseline-2025", targetCo2eKg: round(baselineTotal * 0.7), description: "Reduce campus emissions by 30% by 2030", status: "ACTIVE" }],
    documents: [],
    reports: [],
    recommendations: [
      { id: "rec-solar", title: "Expand rooftop solar on academic buildings", description: "Electricity is the largest source in this sample inventory. Assess rooftop area and interval meter data before procurement.", priority: "HIGH", category: "ENERGY", status: "PENDING", estimatedReductionKg: 165000 },
      { id: "rec-led", title: "Upgrade hostel and library lighting", description: "Pilot LED lighting and occupancy controls. Measure consumption before and after the pilot.", priority: "MEDIUM", category: "ENERGY", status: "IN_PROGRESS", estimatedReductionKg: 42000 },
      { id: "rec-dg", title: "Reduce diesel generator runtime", description: "Track fuel consumption and operating hours; evaluate storage for backup loads.", priority: "MEDIUM", category: "FUEL", status: "PENDING", estimatedReductionKg: 12000 },
    ],
    notifications: [{ id: "notif-review", title: "Three activities need review", message: "October utility and fuel entries are ready in the review center.", type: "REVIEW", isRead: false, createdAt: "2026-10-03T09:00:00.000Z" }, { id: "notif-period", title: "FY 2026–27 is open", message: "You can add activity data and generate a sample report.", type: "SYSTEM", isRead: false, createdAt: "2026-10-01T09:00:00.000Z" }],
    "audit-logs": [{ id: "audit-seed", action: "SEED", entity: "DEMO", description: "Illustrative university demo workspace created", createdAt: "2026-10-01T09:00:00.000Z", user: { firstName: "Demo", lastName: "Administrator" } }],
    "operations/users": [{ id: "demo-admin", name: "Demo Administrator", email: DEMO_EMAIL, role: "ADMIN", isActive: true, status: "ACTIVE", tenantId: DEMO_ORG }, { id: "demo-reviewer", name: "Campus Reviewer", email: "reviewer@carbonsynq.test", role: "REVIEWER", isActive: true, status: "ACTIVE" }, { id: "demo-entry", name: "Facilities Manager", email: "facilities@carbonsynq.test", role: "ENTRY", isActive: true, status: "ACTIVE" }],
    "operations/staff/invitations": [], "operations/ocr": [],
    "university/u_departments": [{ id: "dept-facilities", name: "Facilities & Energy", code: "FAC", head_name: "Demo Facilities Manager" }, { id: "dept-research", name: "Research & Laboratories", code: "RES", head_name: "Demo Research Lead" }, { id: "dept-hostel", name: "Student Housing", code: "HOSTEL" }],
    "university/tasks": [{ id: "task-power", kpi_name: "October electricity consumption", kpi_id: "kpi-electricity", period_name: "FY 2026–27", status: "PENDING", assignee_name: "Facilities Manager" }, { id: "task-fuel", kpi_name: "Generator diesel consumption", kpi_id: "kpi-diesel", period_name: "FY 2026–27", status: "SUBMITTED", assignee_name: "Campus Reviewer" }],
    "university/suppliers": [{ id: "supplier-power", name: "Demo Electricity Supplier", contactEmail: "power@example.test", contact_email: "power@example.test", category: "Electricity", status: "ACTIVE" }, { id: "supplier-fuel", name: "Demo Fuel Supplier", contactEmail: "fuel@example.test", contact_email: "fuel@example.test", category: "Fuel", status: "ACTIVE" }],
    "university/supplier-requests": [{ id: "request-power", title: "Quarterly electricity evidence", description: "Collect monthly consumption statements", status: "DRAFT", created_at: "2026-10-01T09:00:00.000Z" }],
    "university/materiality": [{ id: "materiality-energy", title: "Campus energy and emissions", description: "Illustrative assessment for electricity, backup fuels and resource use.", status: "DRAFT", created_at: "2026-10-01T09:00:00.000Z" }],
    "university/initiatives": [{ id: "initiative-solar", name: "Academic rooftop solar pilot", description: "Measure consumption before expanding solar capacity", target_year: 2030, targetYear: 2030, projected_savings_tco2e: 165, projectedSavingsTco2e: 165, status: "ACTIVE" }],
    "university/pcf-studies": [{ id: "pcf-meal", name: "Campus meal footprint study", product_name: "Canteen meal", productName: "Canteen meal", description: "Illustrative study; supply-chain data collection pending", status: "DRAFT" }],
    "university/voids": [], "university/submissions": [], "university/kpis": [], "university/reports": [], "university-statistics": [],
  };
  for (const rows of Object.values(collections)) for (const row of rows) row.demoSample = true;
  return { version: 2, onboardingCompleted: false, dataMode: "SAMPLE", university, onboarding, collections };
}

// Sample rows are dropped only when real activity exists, so the dashboard,
// reports and inventory always total the user's actual data.
const SAMPLE_LEDGER_KEYS = ["activity-data", "baselines", "targets", "recommendations", "notifications",
  "university/u_departments", "university/tasks", "university/suppliers", "university/supplier-requests",
  "university/materiality", "university/initiatives", "university/pcf-studies"];

function dropSampleLedger(state: DemoState) {
  for (const key of SAMPLE_LEDGER_KEYS) {
    state.collections[key] = (state.collections[key] || []).filter(row => row.demoSample !== true);
  }
}

// The switch happens only after a valid activity is saved, never on a failed
// upload, an extraction-only document, a preview or a profile edit.
export function activateUserData(state: DemoState) {
  if (state.dataMode === "USER") return;
  dropSampleLedger(state);
  state.dataMode = "USER";
  audit(state, "USE_USER_DATA", "WORKSPACE", "First activity saved; sample ledger and sample baseline removed from active inventory");
}

function migrateDemoState(data: Row): DemoState {
  const seeded = seedDemo();
  for (const [key, rows] of Object.entries(data.collections) as [string, Row[]][]) {
    const sampleIds = new Set((seeded.collections[key] || []).map(row => row.id));
    for (const row of rows) row.demoSample ??= sampleIds.has(row.id);
  }
  const hasUserData = data.collections["activity-data"].some((row: Row) => !row.demoSample);
  data.version = 2;
  data.dataMode = "SAMPLE";
  data.onboardingCompleted = hasUserData || data.university.name !== seeded.university.name
    || Boolean(data.onboarding && data.onboarding.updatedAt !== "2026-10-01T00:00:00.000Z");
  if (hasUserData) activateUserData(data as DemoState);
  return data as DemoState;
}

export function getDemoState(): DemoState {
  if (typeof window === "undefined") throw new Error("Demo requests require a browser.");
  const saved = localStorage.getItem(DEMO_KEY);
  if (saved) {
    try {
      const data = JSON.parse(saved);
      if (data.version === 2 && data.collections?.["activity-data"]) {
        // Workspaces saved while the sample ledger was kept alongside real
        // entries: drop the sample rows so the dashboard shows actual data.
        if (data.dataMode === "USER" && SAMPLE_LEDGER_KEYS.some(key => (data.collections[key] || []).some((row: Row) => row.demoSample === true))) {
          dropSampleLedger(data as DemoState); saveDemoState(data as DemoState);
        }
        return data;
      }
      if (data.version === 1 && data.collections?.["activity-data"]) {
        const migrated = migrateDemoState(data); saveDemoState(migrated); return migrated;
      }
    } catch { /* Recreate a corrupt demo workspace. */ }
  }
  const data = seedDemo();
  saveDemoState(data);
  return data;
}

export function saveDemoState(state: DemoState) {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(state)); }
  catch { throw new Error("Browser storage is full or unavailable. Remove old demo uploads or reset the demo."); }
  if (typeof window.dispatchEvent === "function") window.dispatchEvent(new Event(DEMO_STATE_EVENT));
}

export function resetDemo() {
  const state = seedDemo();
  saveDemoState(state);
  for (const key of ["carbonsynq_onboarding_v1", "carbonsynq_org_type", "reportingPeriodId", "reportingPeriodOrgId", "setup_return", "carbonsynq_welcome_dismissed", "carbonsynq_guide_seen"]) localStorage.removeItem(key);
  localStorage.setItem("carbonsynq_org_type", "university");
}

export function audit(state: DemoState, action: string, entity: string, description: string) {
  state.collections["audit-logs"].unshift({ id: newId("audit"), action, entity, description,
    createdAt: new Date().toISOString(), user: { firstName: "Demo", lastName: "Administrator" } });
}
