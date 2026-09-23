export type Role = "employee" | "hr" | "manager";
export type User = {
  username: string;
  role: Role;
  employee_id: string | null;
  full_name: string | null;
  department: string | null;
};
export type Goal = { target_role: string; target_grade: string };
export type Target = { role: string; grade: string; chosen: boolean };
export type Employee = {
  employee_id: string;
  full_name: string;
  department: string;
  role: string;
  grade: string;
  career_goal: Goal | null;
  last_review_date: string;
  work_format: string;
  tenure_months: number;
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
export type Benefit = {
  name: string;
  from: number;
  to: number;
  critical: boolean;
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
  benefits: Benefit[];
};
export type History = {
  record_id: string;
  event_id: string;
  date: string;
  due_date?: string | null;
  completed_at?: string;
  completion_pct?: number;
  score?: number | null;
  title: string;
  status: string;
  format: string;
  mandatory: boolean;
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
  orientation: { role: string; grade: string; readiness: number | null } | null;
  recommendations: Quest[];
  history: History[];
  learning: { open: History[] };
  completions: Completion[];
  notice: string;
  as_of: string;
};
export type Catalog = {
  as_of: string;
  ai_available: boolean;
  profiles: { role: string; grade: string }[];
  skills: { skill_id: string; name: string }[];
};
export type Level = "high" | "medium" | "planned";
export type Priority = {
  level: Level;
  label: string;
  score: number;
  reasons: string[];
  overdue_mandatory: number;
  factors: {
    key: string;
    label: string;
    weight: number;
    value: number;
    points: number;
    detail: string;
  }[];
};
export type Growth = {
  score: number;
  ready: boolean;
  parts: Record<string, number>;
};
export type SourceStatus = "connected" | "not_connected" | "no_account";
export type Source = "github" | "jira";
export type TeamRow = {
  employee_id: string;
  full_name: string;
  department: string;
  role: string;
  grade: string;
  target: Target;
  readiness: number;
  coverage: number;
  gaps: number;
  critical_gaps: number;
  priority: Priority;
  growth: Growth;
  sources: Record<Source, SourceStatus>;
};
export type Insight = {
  employee_id: string;
  full_name: string;
  role: string;
  title: string;
  text: string;
  sufficient: boolean;
  evidence: number;
  sources: Source[];
  discussed: boolean;
};
export type TeamOverview = {
  as_of: string;
  scope: { role: Role; department: string | null; total: number };
  departments: string[];
  roles: string[];
  metrics: {
    employees: number;
    with_critical_gap: number;
    avg_readiness: number | null;
    without_goal: number;
    completed: number;
    overdue: number;
  };
  priority_counts: Record<Level, number>;
  growth_count: number;
  gaps: { name: string; count: number }[];
  activity: Record<
    | "completed"
    | "voluntary_completed"
    | "no_show"
    | "dropped"
    | "declined"
    | "in_progress",
    number
  >;
  sources: {
    github: number;
    github_accounts: number;
    jira: number;
    none: number;
  };
  insights: Insight[];
  employees: TeamRow[];
  pending: Completion[];
};
export type Evidence = {
  source: Source;
  resource: string;
  title: string;
  note: string;
  date: string;
  id: string;
};
export type WorkRecord = {
  id: string;
  kind: string;
  status: string;
  date: string;
  skill_id: string;
  resource: string;
  story_points?: number;
  reviews?: number;
};
export type SourceDigest = {
  status: SourceStatus;
  login?: string;
  resources?: string[];
  synced_at?: string;
  summary?: Record<string, number>;
  top_skills?: { name: string; count: number }[];
  records?: WorkRecord[];
};
export type Signal = {
  title: string;
  text: string;
  skill: string;
  skill_id: string;
  sufficient: boolean;
  practice: string;
  evidence: Evidence[];
  period: string;
};
export type Digest = {
  sources: Record<Source, SourceDigest>;
  signal: Signal | null;
};
export type Card = {
  employee: Pick<
    Employee,
    | "employee_id"
    | "full_name"
    | "department"
    | "role"
    | "grade"
    | "last_review_date"
  >;
  manager: string | null;
  target: Target;
  readiness: number;
  coverage: number;
  priority: Priority;
  growth: Growth;
  gaps: Gap[];
  recommendations: Pick<
    Quest,
    | "event_id"
    | "title"
    | "format"
    | "duration_hours"
    | "next_session"
    | "benefits"
  >[];
  open_learning: History[];
  integrations: Digest;
  discussed: boolean;
};
export type Integrations = {
  can_manage: boolean;
  period: string;
  sources: Record<
    Source,
    SourceDigest & { available: boolean; choices: string[] }
  >;
  signal: Signal | null;
};
