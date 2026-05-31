CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS public.sellers (
  id TEXT PRIMARY KEY,
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  building_label TEXT NOT NULL,
  zelle_recipient_name TEXT NOT NULL,
  zelle_recipient_email TEXT NOT NULL,
  demo_mode BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tiers (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  cadence TEXT NOT NULL DEFAULT 'weekly',
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id TEXT NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  tier_id TEXT REFERENCES public.tiers(id) ON DELETE SET NULL,
  telegram_handle TEXT,
  telegram_chat_id TEXT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  floor INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'onboarding'
    CHECK (status IN ('onboarding', 'pending_payment', 'paid', 'flagged', 'paused', 'cancelled')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, unit)
);

CREATE UNIQUE INDEX IF NOT EXISTS subscribers_seller_chat_uidx
ON public.subscribers (seller_id, telegram_chat_id)
WHERE telegram_chat_id IS NOT NULL AND telegram_chat_id <> '';

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id TEXT NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  subscriber_id UUID NOT NULL REFERENCES public.subscribers(id) ON DELETE CASCADE,
  tier_id TEXT REFERENCES public.tiers(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  receipt_artifact_key TEXT,
  extracted_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_extraction JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'flagged', 'rejected')),
  confidence NUMERIC(5,4),
  confirmation_number TEXT,
  reason_code TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  reviewer_note TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_confirmation_uidx
ON public.payments (seller_id, lower(confirmation_number))
WHERE confirmation_number IS NOT NULL AND confirmation_number <> '';

CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id TEXT NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  subscriber_id UUID NOT NULL REFERENCES public.subscribers(id) ON DELETE CASCADE,
  tier_id TEXT REFERENCES public.tiers(id) ON DELETE SET NULL,
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  manifest_date DATE NOT NULL DEFAULT CURRENT_DATE,
  manifest_artifact_key TEXT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  floor INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'dispatched', 'delivered', 'skipped')),
  delivery_note TEXT,
  dispatched_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, subscriber_id, manifest_date)
);

CREATE TABLE IF NOT EXISTS public.agent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id TEXT NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'subscriber_paid',
      'payment_flagged',
      'manifest_generated',
      'delivery_updated'
    )
  ),
  message TEXT NOT NULL,
  subscriber_id UUID REFERENCES public.subscribers(id) ON DELETE SET NULL,
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tiers_seller_idx ON public.tiers (seller_id, active, sort_order);
CREATE INDEX IF NOT EXISTS subscribers_seller_status_idx ON public.subscribers (seller_id, status, floor, unit);
CREATE INDEX IF NOT EXISTS payments_seller_status_idx ON public.payments (seller_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_subscriber_idx ON public.payments (subscriber_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_seller_manifest_idx ON public.orders (seller_id, manifest_date DESC, floor, unit);
CREATE INDEX IF NOT EXISTS agent_events_seller_created_idx ON public.agent_events (seller_id, created_at DESC);

DROP TRIGGER IF EXISTS sellers_set_updated_at ON public.sellers;
CREATE TRIGGER sellers_set_updated_at
BEFORE UPDATE ON public.sellers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS tiers_set_updated_at ON public.tiers;
CREATE TRIGGER tiers_set_updated_at
BEFORE UPDATE ON public.tiers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS subscribers_set_updated_at ON public.subscribers;
CREATE TRIGGER subscribers_set_updated_at
BEFORE UPDATE ON public.subscribers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS payments_set_updated_at ON public.payments;
CREATE TRIGGER payments_set_updated_at
BEFORE UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS orders_set_updated_at ON public.orders;
CREATE TRIGGER orders_set_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sellers_select_owned_or_demo ON public.sellers;
CREATE POLICY sellers_select_owned_or_demo
ON public.sellers FOR SELECT
TO authenticated
USING (owner_user_id IS NULL OR owner_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS sellers_modify_owned ON public.sellers;
CREATE POLICY sellers_modify_owned
ON public.sellers FOR ALL
TO authenticated
USING (owner_user_id = (SELECT auth.uid()))
WITH CHECK (owner_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tiers_select_seller_visible ON public.tiers;
CREATE POLICY tiers_select_seller_visible
ON public.tiers FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sellers s
    WHERE s.id = tiers.seller_id
      AND (s.owner_user_id IS NULL OR s.owner_user_id = (SELECT auth.uid()))
  )
);

DROP POLICY IF EXISTS subscribers_select_seller_visible ON public.subscribers;
CREATE POLICY subscribers_select_seller_visible
ON public.subscribers FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sellers s
    WHERE s.id = subscribers.seller_id
      AND (s.owner_user_id IS NULL OR s.owner_user_id = (SELECT auth.uid()))
  )
);

DROP POLICY IF EXISTS payments_select_seller_visible ON public.payments;
CREATE POLICY payments_select_seller_visible
ON public.payments FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sellers s
    WHERE s.id = payments.seller_id
      AND (s.owner_user_id IS NULL OR s.owner_user_id = (SELECT auth.uid()))
  )
);

DROP POLICY IF EXISTS orders_select_seller_visible ON public.orders;
CREATE POLICY orders_select_seller_visible
ON public.orders FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sellers s
    WHERE s.id = orders.seller_id
      AND (s.owner_user_id IS NULL OR s.owner_user_id = (SELECT auth.uid()))
  )
);

DROP POLICY IF EXISTS agent_events_select_seller_visible ON public.agent_events;
CREATE POLICY agent_events_select_seller_visible
ON public.agent_events FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sellers s
    WHERE s.id = agent_events.seller_id
      AND (s.owner_user_id IS NULL OR s.owner_user_id = (SELECT auth.uid()))
  )
);

INSERT INTO realtime.channels (pattern, description, enabled)
VALUES ('seller:%', 'ResidentOS seller-scoped operational events', true)
ON CONFLICT (pattern) DO UPDATE
SET description = EXCLUDED.description,
    enabled = EXCLUDED.enabled;

CREATE OR REPLACE FUNCTION public.publish_residentos_agent_event()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM realtime.publish(
    'seller:' || NEW.seller_id,
    NEW.event_type,
    jsonb_build_object(
      'id', NEW.id,
      'seller_id', NEW.seller_id,
      'event_type', NEW.event_type,
      'message', NEW.message,
      'subscriber_id', NEW.subscriber_id,
      'payment_id', NEW.payment_id,
      'order_id', NEW.order_id,
      'payload', NEW.payload,
      'created_at', NEW.created_at
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS agent_events_publish_realtime ON public.agent_events;
CREATE TRIGGER agent_events_publish_realtime
AFTER INSERT ON public.agent_events
FOR EACH ROW EXECUTE FUNCTION public.publish_residentos_agent_event();

INSERT INTO public.sellers (
  id,
  building_label,
  zelle_recipient_name,
  zelle_recipient_email,
  demo_mode,
  metadata
)
VALUES (
  'demo-seller',
  'Juniper House',
  'Cristian Rosca',
  'rosca.cris18@gmail.com',
  true,
  '{"telegram_bot_username":"locallebot"}'::jsonb
)
ON CONFLICT (id) DO UPDATE
SET building_label = EXCLUDED.building_label,
    zelle_recipient_name = EXCLUDED.zelle_recipient_name,
    zelle_recipient_email = EXCLUDED.zelle_recipient_email,
    demo_mode = EXCLUDED.demo_mode,
    metadata = public.sellers.metadata || EXCLUDED.metadata;

INSERT INTO public.tiers (id, seller_id, name, amount_cents, cadence, sort_order, metadata)
VALUES
  ('weekly-5', 'demo-seller', 'Demo Bowl', 500, 'weekly', 10, '{"demo":true}'::jsonb),
  ('weekly-9', 'demo-seller', 'Double Portion', 900, 'weekly', 20, '{"demo":true}'::jsonb),
  ('weekly-15', 'demo-seller', 'Family Drop', 1500, 'weekly', 30, '{"demo":true}'::jsonb)
ON CONFLICT (id) DO UPDATE
SET seller_id = EXCLUDED.seller_id,
    name = EXCLUDED.name,
    amount_cents = EXCLUDED.amount_cents,
    cadence = EXCLUDED.cadence,
    sort_order = EXCLUDED.sort_order,
    active = true,
    metadata = public.tiers.metadata || EXCLUDED.metadata;
