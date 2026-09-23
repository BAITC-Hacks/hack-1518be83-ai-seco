export type User = {
  username: string;
  role: "employee" | "hr";
  employee_id: string | null;
};
export type Goal = { target_role: string; target_grade: string };
export type Employee = {
  employee_id: string;
  full_name: string;
  department: string;
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
  benefits: { name: string; from: number; to: number; critical: boolean }[];
};
export type History = {
  record_id: string;
  event_id: string;
  date: string;
  completed_at?: string;
  title: string;
  status: string;
  format: string;
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
};
export type Catalog = {
  as_of: string;
  ai_available: boolean;
  profiles: { role: string; grade: string }[];
  skills: { skill_id: string; name: string }[];
};
export type HRRow = {
  employee_id: string;
  full_name: string;
  role: string;
  grade: string;
  readiness: number | null;
  signals: string[];
  goal: Goal | null;
};
export type Overview = {
  total: number;
  without_goal: number;
  employees: HRRow[];
  pending: Completion[];
  gaps: { name: string; count: number }[];
};
