/*
  Central AI Pipeline Tracker — settings

  LEAVE BOTH VALUES EMPTY  → personal mode: data is saved only on this computer.
  FILL BOTH VALUES IN      → team mode: sign in by email, share with colleagues, live sync.

  Where to find them: Supabase dashboard → Project Settings → API
    supabaseUrl     = "Project URL"        e.g. https://abcdefghijkl.supabase.co
    supabaseAnonKey = "anon public" key    (safe to publish; access is protected by the SQL rules)

  Never put the "service_role" key here.
*/
window.CRM_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: ""
};
