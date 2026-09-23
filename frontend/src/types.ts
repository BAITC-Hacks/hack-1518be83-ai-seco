export type User = {
  username: string;
  role: "employee" | "hr" | "manager";
  employee_id: string | null;
};
export type Goal = { target_role: string; target_grade: string };
export type Employee = {
  employee_id: string;
  full_name: string;
  department: string;
  hire_date: string;
  work_format: string;
  preferred_language: string;
  role: string;
  grade: string;
  career_goal: Goal | null;
  last_review_date: string;
  skills: Record<string, number>;
};
export type Gap = {
  skill_id: string;
  name: string;
  current: number;
  required: number;
  gap: number;
  critical: boolean;
  assessed: boolean;
};
export type Quest = {
  event_id: string;
  title: string;
  description: string;
  format: string;
  duration_hours: number;
  next_session: string | null;
  reason: string;
  past_misses: number;
  similar_misses?: number;
  benefits: {
    name: string;
    from: number;
    to: number;
    critical: boolean;
    evidence?: boolean;
  }[];
};
export type History = {
  record_id: string;
  event_id: string;
  date: string;
  completed_at?: string;
  title: string;
  status: string;
  format: string;
  mandatory: boolean;
  due_date?: string | null;
  completion_pct: number;
  duration_hours: number;
};
export type Completion = {
  id: string;
  employee_id: string;
  event_id: string;
  full_name?: string;
  title: string;
  completed_at: string;
  evidence: string;
  status: string;
  review_note: string;
};
export type Profile = {
  employee: Employee;
  levels: Record<string, number>;
  gaps: Gap[];
  readiness: number | null;
  recommendations: Quest[];
  history: History[];
  completions: Completion[];
  notice: string;
  as_of: string;
  grade_since: string | null;
  grade_months: number | null;
  grade_record: {
    grade_since: string | null;
    revision: number;
    history: {
      grade_since: string;
      note: string;
      reviewer: string;
      recorded_at: string;
    }[];
  };
  development_plan: DevelopmentPlan | null;
  onboarding: {
    status: "pending_assessment" | "assessed";
    specialization: string;
  } | null;
  assessment: {
    assessed_on: string;
    method: string;
    reviewer: string;
    note: string;
    ratings: { skill_id: string; level: number; evidence: string }[];
  } | null;
};
export type Catalog = {
  as_of: string;
  ai_available: boolean;
  profiles: {
    role: string;
    grade: string;
    required_skills: Record<string, number>;
    critical_skills: string[];
  }[];
  skills: { skill_id: string; name: string }[];
};
export type HRRow = {
  employee_id: string;
  full_name: string;
  department: string;
  role: string;
  grade: string;
  readiness: number | null;
  signals: string[];
  goal: Goal | null;
  grade_since: string | null;
  grade_months: number | null;
  priority: "high" | "medium" | "planned";
  critical_gaps: number;
  paused: boolean;
  mandatory_overdue: number;
  plan: DevelopmentPlan | null;
};
export type Overview = {
  total: number;
  without_goal: number;
  employees: HRRow[];
  pending: Completion[];
  gaps: { name: string; count: number }[];
  department: string | null;
  departments: string[];
  as_of: string;
  priorities: Record<"high" | "medium" | "planned", number>;
  policy: SupportPolicy;
  hr_owners: string[];
};
export type SupportPolicy = {
  inactivity_days: number;
  grade_months: number;
  misses: number;
};
export type DevelopmentPlan = {
  status: "discussion" | "active" | "paused" | "closed";
  owner: string;
  next_review_on: string | null;
  note: string;
  revision: number;
  updated_by: string;
  updated_at: string;
};
export type EvidenceItem = {
  artifact_id: string;
  artifact_title: string;
  source: string;
  url: string;
  version: string;
  task_key: string;
  finding_id?: string;
  text?: string;
  outcome?: "open" | "fixed";
  shared: boolean;
};
export type Observation = {
  observation_id: string;
  criterion_id: string;
  criterion_title: string;
  skill_id: string;
  kind: "development" | "strength";
  task_keys: string[];
  evidence: EvidenceItem[];
  limitations: string[];
  summary: string;
  alternative: string;
  summary_mode: "rules" | "ai";
  status: "draft" | "confirmed" | "rejected";
  comments: { author: string; role: string; text: string; at: string }[];
  review: {
    reviewer: string;
    note: string;
    decision: string;
    at: string;
  } | null;
};
export type WorkEvidence = {
  artifacts: {
    artifact_id: string;
    source: string;
    title: string;
    version: string;
    task_key: string | null;
    contribution: "author" | "co_author";
    shared: boolean;
    findings: number;
  }[];
  tasks: {
    task_id: string;
    key: string;
    title: string;
    estimate_hours: number | null;
    logged_hours: number;
    blocked_hours: number;
  }[];
  observations: Observation[];
  insufficient: {
    criterion_id: string;
    title: string;
    kind: string;
    tasks: string[];
    reason: string;
  }[];
  focus: { skill_id: string; name: string; note: string; courses: string[] }[];
  unmatched_artifacts: number | null;
  skill_names: Record<string, string>;
};
export type EvidenceQueue = {
  drafts: {
    observation_id: string;
    employee_id: string;
    full_name: string;
    criterion_title: string;
    kind: string;
    task_keys: string[];
  }[];
};
