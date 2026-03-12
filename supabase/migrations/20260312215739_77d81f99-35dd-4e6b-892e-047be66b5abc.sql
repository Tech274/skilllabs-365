-- Create session_events table for recording session activity
CREATE TABLE public.session_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_session_events_session_id ON public.session_events(session_id);
CREATE INDEX idx_session_events_created_at ON public.session_events(created_at);

ALTER TABLE public.session_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage session events"
  ON public.session_events FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Instructors can view session events for assigned labs"
  ON public.session_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sessions s
      JOIN public.lab_assignments la ON la.lab_template_id = s.lab_template_id
      WHERE s.id = session_events.session_id
      AND la.instructor_id = auth.uid()
    )
  );

CREATE POLICY "Students can view own session events"
  ON public.session_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_events.session_id
      AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert events for own sessions"
  ON public.session_events FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_events.session_id
      AND s.user_id = auth.uid()
    )
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.session_events;