import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../../middleware/require-auth.js';
import { createUserSupabaseClient } from '../../lib/supabase.js';

import {
  addLeadNoteSchema,
  createLeadSchema,
  changeLeadStatusSchema,
  listLeadsSchema,
  createBookingSchema,
} from './leads.schema.js';

import {
  addLeadNote,
  createLead,
  changeLeadStatus,
  createBooking,
  listLeads,
  listLeadEvents,
} from './leads.service.js';

export const leadsRouter = Router();


leadsRouter.post('/:leadId/booking', requireAuth, async (req, res) => {
  const leadId = z.uuid().safeParse(req.params.leadId);
  const body = createBookingSchema.safeParse(req.body);

  if (!leadId.success || !body.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR' } });
    return;
  }

  try {
    const { data, error } = await createBooking(
      res.locals.auth!.accessToken,
      leadId.data,
      body.data,
    );

    if (error) {
      const status = error.code === '42501'
        ? 403
        : error.code === '40001'
          ? 409
          : error.code === '22023'
            ? 400
            : 502;

      res.status(status).json({
        error: {
          code: status === 403
            ? 'FORBIDDEN'
            : status === 409
              ? 'STALE_LEAD'
              : status === 400
                ? 'BOOKING_REJECTED'
                : 'BOOKING_FAILED',
        },
      });
      return;
    }

    res.status(201).json({ data: { appointment_id: data } });
  } catch {
    res.status(502).json({ error: { code: 'BOOKING_FAILED' } });
  }
});

leadsRouter.get('/:leadId', requireAuth, async (req, res) => {
  const leadId = z.uuid().safeParse(req.params.leadId);
  const clinicId = z.uuid().safeParse(req.query.clinic_id);
  if (!leadId.success || !clinicId.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR' } });
    return;
  }

  try {
    const { data, error } = await createUserSupabaseClient(
      res.locals.auth!.accessToken,
    )
      .from('leads')
      .select(`
        id, clinic_id, status, source, created_at,
        requested_service_name_snapshot, contact_type_at_creation,
        contact:contacts (full_name, phone)
      `)
      .eq('id', leadId.data)
      .eq('clinic_id', clinicId.data)
      .is('archived_at', null)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: { code: 'LEAD_NOT_FOUND' } });
      return;
    }

    res.json({ data });
  } catch {
    res.status(502).json({ error: { code: 'LEAD_FETCH_FAILED' } });
  }
});

leadsRouter.post('/:leadId/status', requireAuth, async (req, res) => {
  const leadId = z.uuid().safeParse(req.params.leadId);
  const body = changeLeadStatusSchema.safeParse(req.body);
  if (!leadId.success || !body.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR' } });
    return;
  }

  try {
    const { data, error } = await changeLeadStatus(
      res.locals.auth!.accessToken,
      leadId.data,
      body.data,
    );

    if (error) {
      const status = error.code === '42501'
        ? 403
        : error.code === '40001'
          ? 409
          : error.code === '22023'
            ? 400
            : 502;

      res.status(status).json({
        error: {
          code: status === 409
            ? 'STALE_LEAD'
            : status === 403
              ? 'FORBIDDEN'
              : status === 400
                ? 'INVALID_TRANSITION'
                : 'STATUS_CHANGE_FAILED',
        },
      });
      return;
    }

    res.json({ data: { event_id: data } });
  } catch {
    res.status(502).json({ error: { code: 'STATUS_CHANGE_FAILED' } });
  }
});

leadsRouter.get('/', requireAuth, async (req, res) => {
  const auth = res.locals.auth;

  if (!auth) {
    res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      },
    });
    return;
  }

  const parsed = listLeadsSchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please check the query parameters',
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  try {
    const { data, error } = await listLeads(
      auth.accessToken,
      parsed.data,
    );

    if (error) {
      console.error('Failed to list leads:', error.code);

      res.status(502).json({
        error: {
          code: 'LEADS_FETCH_FAILED',
          message: 'Unable to load leads',
        },
      });
      return;
    }

    const rows = data ?? [];
    const { page, page_size } = parsed.data;

    res.status(200).json({
      data: rows.slice(0, page_size),
      pagination: {
        page,
        page_size,
        has_more: rows.length > page_size,
      },
    });
  } catch {
    res.status(502).json({
      error: {
        code: 'LEADS_FETCH_UNAVAILABLE',
        message: 'Unable to load leads',
      },
    });
  }
});

leadsRouter.post('/', requireAuth, async (req, res) => {
  const auth = res.locals.auth;

  if (!auth) {
    res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      },
    });
    return;
  }

  const parsed = createLeadSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please check the submitted fields',
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  try {
    const { data, error } = await createLead(
      auth.accessToken,
      parsed.data,
    );

    if (error) {
      if (error.code === '42501') {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'You are not allowed to create this lead',
          },
        });
        return;
      }

      if (
        ['22023', '23502', '23503', '23514'].includes(error.code)
      ) {
        res.status(400).json({
          error: {
            code: 'LEAD_REJECTED',
            message:
              'Check the submitted data and that the selected clinic, service, and ad are available',
          },
        });
        return;
      }

      if (error.code === '23505') {
        res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: 'The submitted data conflicts with an existing record',
          },
        });
        return;
      }

      if (['40001', '40P01'].includes(error.code)) {
        res.status(503).json({
          error: {
            code: 'RETRY_REQUIRED',
            message: 'Retry the same request using the same request_id',
          },
        });
        return;
      }

      console.error('create_lead failed:', error.code);

      res.status(502).json({
        error: {
          code: 'LEAD_CREATION_FAILED',
          message: 'Unable to complete the request. Retry with the same request_id',
        },
      });
      return;
    }

    if (
      !data ||
      typeof data.lead_id !== 'string' ||
      typeof data.replayed !== 'boolean'
    ) {
      res.status(502).json({
        error: {
          code: 'INVALID_DATABASE_RESPONSE',
          message: 'Unable to confirm the result. Retry with the same request_id',
        },
      });
      return;
    }

    res.status(data.replayed ? 200 : 201).json({
      data: {
        lead_id: data.lead_id,
        replayed: data.replayed,
      },
    });
  } catch {
    res.status(502).json({
      error: {
        code: 'LEAD_CREATION_UNAVAILABLE',
        message: 'Unable to complete the request. Retry with the same request_id',
      },
    });
  }
});

leadsRouter.post('/:leadId/notes', requireAuth, async (req, res) => {
  const auth = res.locals.auth;

  if (!auth) {
    res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      },
    });
    return;
  }

  const leadId = z.uuid().safeParse(req.params.leadId);
  const body = addLeadNoteSchema.safeParse(req.body);

  if (!leadId.success || !body.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please check the lead ID and note',
      },
    });
    return;
  }

  try {
    const { data, error } = await addLeadNote(
      auth.accessToken,
      leadId.data,
      body.data,
    );

    if (error) {
      if (error.code === '42501') {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'You are not allowed to add a note to this lead',
          },
        });
        return;
      }

      if (['22023', '23503'].includes(error.code)) {
        res.status(400).json({
          error: {
            code: 'NOTE_REJECTED',
            message: 'Check the clinic, lead, and note',
          },
        });
        return;
      }

      console.error('add_lead_note failed:', error.code);

      res.status(502).json({
        error: {
          code: 'NOTE_CREATION_FAILED',
          message: 'Unable to add the note',
        },
      });
      return;
    }

    res.status(201).json({
      data: { note_id: data },
    });
  } catch {
    res.status(502).json({
      error: {
        code: 'NOTE_CREATION_UNAVAILABLE',
        message: 'Unable to add the note',
      },
    });
  }
});

leadsRouter.get('/:leadId/events', requireAuth, async (req, res) => {
  const auth = res.locals.auth;

  if (!auth) {
    res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      },
    });
    return;
  }

  const leadId = z.uuid().safeParse(req.params.leadId);
  const query = listLeadsSchema.safeParse(req.query);

  if (!leadId.success || !query.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please check the lead ID and query parameters',
      },
    });
    return;
  }

  try {
    const { data, error } = await listLeadEvents(
      auth.accessToken,
      leadId.data,
      query.data,
    );

    if (error) {
      console.error('Failed to list lead events:', error.code);

      res.status(502).json({
        error: {
          code: 'EVENTS_FETCH_FAILED',
          message: 'Unable to load lead events',
        },
      });
      return;
    }

    const rows = data ?? [];
    const { page, page_size } = query.data;

    res.status(200).json({
      data: rows.slice(0, page_size),
      pagination: {
        page,
        page_size,
        has_more: rows.length > page_size,
      },
    });
  } catch {
    res.status(502).json({
      error: {
        code: 'EVENTS_FETCH_UNAVAILABLE',
        message: 'Unable to load lead events',
      },
    });
  }
});

