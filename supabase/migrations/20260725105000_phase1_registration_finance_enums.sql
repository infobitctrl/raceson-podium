/*
 * Registration and payment lifecycles are deliberately separate. These
 * values make offers, expiry, partial refunds, and disputes explicit instead
 * of overloading "pending" or relying on provider state in the browser.
 */

alter type public.registration_status add value if not exists 'offered' after 'waitlisted';
alter type public.registration_status add value if not exists 'expired' after 'cancelled';
alter type public.registration_status add value if not exists 'transferred' after 'expired';
alter type public.registration_status add value if not exists 'deferred' after 'transferred';

alter type public.payment_status add value if not exists 'pending' after 'unpaid';
alter type public.payment_status add value if not exists 'partially_refunded' after 'refunded';
alter type public.payment_status add value if not exists 'disputed' after 'partially_refunded';
