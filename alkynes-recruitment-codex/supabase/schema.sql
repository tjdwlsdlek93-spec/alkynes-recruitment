create type recruitment_status as enum ('채용요청','요청검토','채용승인','공고중','서류검토','면접예정','면접완료','처우협의','입사확정','채용완료','채용보류','채용취소');
create type candidate_status as enum ('검토중','서류합격','서류불합격','일정조율','면접예정','면접완료','처우협의','최종합격','불합격','입사확정','입사포기');

create table requisitions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  department text not null,
  requester text,
  role text not null,
  headcount int not null default 1,
  reason text,
  duties text,
  requirements text,
  preferred text,
  target_join_date date,
  status recruitment_status not null default '채용요청',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table candidates (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references requisitions(id) on delete cascade,
  name text not null,
  source text,
  career_summary text,
  phone text,
  email text,
  resume_url text,
  status candidate_status not null default '검토중',
  notes text,
  created_at timestamptz not null default now()
);

create table interviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  starts_at timestamptz,
  location text,
  interviewers text[] default '{}',
  status text default '일정조율',
  created_at timestamptz not null default now()
);

create table evaluations (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references interviews(id) on delete cascade,
  evaluator_email text not null,
  job_fit text not null,
  capability text not null,
  culture_fit text not null,
  overall text not null,
  comment text,
  created_at timestamptz not null default now(),
  unique(interview_id, evaluator_email)
);
