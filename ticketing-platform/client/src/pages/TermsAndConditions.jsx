import React from 'react';
import { Link } from 'react-router-dom';

export default function TermsAndConditions() {
  return (
    <div className="container narrow">
      <h1>Terms &amp; Conditions</h1>
      <p className="muted">Last updated: September 2026</p>
      <p>
        These Terms &amp; Conditions (“T&amp;Cs”) apply to the purchase and use of tickets through EventEase. By placing
        a booking on EventEase you agree to these T&amp;Cs, together with our <Link to="/terms">Terms of Use</Link>.
      </p>

      <h2>1. Ticket Purchase</h2>
      <p>
        Tickets are electronic (e-tickets) and are delivered to your account with a QR code. Confirmation of your
        booking occurs only after payment has been successfully completed. You are responsible for ensuring the
        contact and billing details you provide are correct.
      </p>

      <h2>2. Pricing &amp; Payment</h2>
      <p>
        All prices are displayed in the currency shown at the event page and include any applicable taxes unless stated
        otherwise. We accept the payment methods shown at checkout. Each ticket sold is a licence to attend a specific
        event and may not be used for commercial purposes without prior written consent.
      </p>

      <h2>3. Cancellation &amp; Refunds</h2>
      <ul>
        <li>
          <strong>Pending bookings</strong> (not yet paid) can be cancelled instantly and are released without charge.
        </li>
        <li>
          <strong>Confirmed bookings</strong> may be submitted for a refund, subject to admin review and approval.
        </li>
        <li>
          If an event is cancelled by the organiser, eligible bookings will be refunded in accordance with the
          organiser’s policy.
        </li>
      </ul>
      <p>
        Refund requests are processed on a case-by-case basis. Submitting a refund request does not guarantee approval.
      </p>

      <h2>4. Resale &amp; Transfers</h2>
      <p>
        Tickets may be resold through the official EventEase resale market or transferred privately to another user.
        Reselling tickets on third-party platforms or at inflated prices in a manner that breaches platform rules is
        prohibited and may result in the invalidation of your tickets.
      </p>

      <h2>5. Entry &amp; Admission</h2>
      <p>
        Each QR code is validated once at entry and is bound to the account that holds the ticket. The venue reserves
        the right to refuse admission for any reasonable reason, including disorderly behaviour. Lost or duplicated
        tickets can be re-issued through your account.
      </p>

      <h2>6. Code of Conduct</h2>
      <p>
        You agree to behave lawfully and respectfully at events. Organisers and venue staff may remove attendees whose
        behaviour endangers others or disrupts the event, without refund.
      </p>

      <h2>7. Limitation of Liability</h2>
      <p>
        To the extent permitted by law, EventEase is not liable for loss, damage, or injury arising from the events you
        attend, beyond any refund obligations set out in these T&amp;Cs. You attend events at your own risk.
      </p>

      <h2>8. Governing Law</h2>
      <p>
        These T&amp;Cs are governed by the laws of Singapore. Any disputes will be subject to the exclusive jurisdiction
        of the Singapore courts.
      </p>

      <h2>9. Contact</h2>
      <p>
        For questions about these Terms &amp; Conditions, contact the EventEase team via the support channels listed in
        the footer.
      </p>

      <p className="muted small"><Link to="/">← Back to browse events</Link></p>
    </div>
  );
}