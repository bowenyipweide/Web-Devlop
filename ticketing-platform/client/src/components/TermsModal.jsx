import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

// Scroll-required terms dialog. The accept button stays hidden until the user
// has scrolled the terms content to the very bottom.
export default function TermsModal({ open, onClose, onAccept, kind }) {
  const boxRef = useRef(null);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAtEnd(false);
    const el = boxRef.current;
    if (el) el.scrollTop = 0;
  }, [open]);

  const handleScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = el.scrollHeight <= el.clientHeight || dist < 6;
    if (atBottom && !atEnd) setAtEnd(true);
  };

  if (!open) return null;

  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box terms-modal" role="dialog" aria-modal="true" aria-label="Terms and Conditions">
        <h2>{kind === 'checkout' ? 'Terms &amp; Conditions — Checkout' : 'Terms &amp; Conditions'}</h2>
        <p className="muted small">
          Please read the full terms below. The accept button appears once you reach the end.
        </p>

        <div className="terms-scroll" ref={boxRef} onScroll={handleScroll} tabIndex={0}>
          <h3 id="tac-title">Terms &amp; Conditions of Ticket Purchase</h3>
          <p className="muted small">Last updated: September 2026</p>
          <p>
            These Terms &amp; Conditions (“T&amp;Cs”) apply to the purchase and use of tickets through EventEase.
            By placing a booking on EventEase you agree to these T&amp;Cs, together with the Terms of Use below.
          </p>
          <h4>1. Ticket Purchase</h4>
          <p>
            Tickets are electronic (e-tickets) and are delivered to your account with a QR code. Confirmation of your
            booking occurs only after payment has been successfully completed. You are responsible for ensuring the
            contact and billing details you provide are correct.
          </p>
          <h4>2. Pricing &amp; Payment</h4>
          <p>
            All prices are displayed in the currency shown at the event page and include any applicable taxes unless
            stated otherwise. We accept the payment methods shown at checkout. Each ticket sold is a licence to attend
            a specific event and may not be used for commercial purposes without prior written consent.
          </p>
          <h4>3. Cancellation &amp; Refunds</h4>
          <ul>
            <li><strong>Pending bookings</strong> (not yet paid) can be cancelled instantly and are released without charge.</li>
            <li><strong>Confirmed bookings</strong> may be submitted for a refund, subject to admin review and approval.</li>
            <li>If an event is cancelled by the organiser, eligible bookings will be refunded in accordance with the organiser’s policy.</li>
          </ul>
          <p>Refund requests are processed on a case-by-case basis. Submitting a refund request does not guarantee approval.</p>
          <h4>4. Resale &amp; Transfers</h4>
          <p>
            Tickets may be resold through the official EventEase resale market or transferred privately to another user.
            Reselling tickets on third-party platforms or at inflated prices in a manner that breaches platform rules is
            prohibited and may result in the invalidation of your tickets.
          </p>
          <h4>5. Entry &amp; Admission</h4>
          <p>
            Each QR code is validated once at entry and is bound to the account that holds the ticket. The venue reserves
            the right to refuse admission for any reasonable reason, including disorderly behaviour. Lost or duplicated
            tickets can be re-issued through your account.
          </p>
          <h4>6. Code of Conduct</h4>
          <p>
            You agree to behave lawfully and respectfully at events. Organisers and venue staff may remove attendees whose
            behaviour endangers others or disrupts the event, without refund.
          </p>
          <h4>7. Limitation of Liability</h4>
          <p>
            To the extent permitted by law, EventEase is not liable for loss, damage, or injury arising from the events
            you attend, beyond any refund obligations set out in these T&amp;Cs. You attend events at your own risk.
          </p>
          <h4>8. Governing Law</h4>
          <p>
            These T&amp;Cs are governed by the laws of Singapore. Any disputes will be subject to the exclusive
            jurisdiction of the Singapore courts.
          </p>
          <h4>9. Contact</h4>
          <p>For questions about these Terms &amp; Conditions, contact the EventEase team via the support channels listed in the footer.</p>

          <h3 id="tou-title">Terms of Use</h3>
          <p className="muted small">Last updated: September 2026</p>
          <p>
            Welcome to EventEase (operated by eventease_grp6, NTU Group 6). These Terms of Use govern your access to
            and use of the EventEase website and services (the “Service”). By creating an account, browsing events, or
            making a purchase, you agree to be bound by these terms.
          </p>
          <h4>1. Use of the Service</h4>
          <p>
            EventEase provides a ticketing platform for events such as concerts, theatre, sports and cultural activities.
            You agree to use the Service only for lawful purposes and in a way that does not infringe the rights of
            others or restrict anyone else from enjoying the Service.
          </p>
          <h4>2. Accounts</h4>
          <p>
            You are responsible for the accuracy of the information you provide when registering and for safeguarding your
            account credentials. You must notify us immediately of any unauthorised use of your account. We may suspend
            or terminate accounts that violate these terms or the safety of other users.
          </p>
          <h4>3. Acceptable Conduct</h4>
          <p>You must not use the Service to:</p>
          <ul>
            <li>engage in fraudulent activity, including chargeback abuse or scalping that violates platform rules;</li>
            <li>misuse, hack, or attempt to disrupt the Service or its data;</li>
            <li>post false or misleading event information;</li>
            <li>attempt to gain unauthorised access to other users’ accounts or the platform.</li>
          </ul>
          <h4>4. Intellectual Property</h4>
          <p>
            All content on the Service — including text, graphics, logos, event listings and software — is the property
            of EventEase or its licensors and is protected by applicable intellectual property laws. You may not
            reproduce, distribute, or create derivative works without prior written permission.
          </p>
          <h4>5. Disclaimer of Warranties</h4>
          <p>
            The Service is provided “as is” and “as available”. EventEase makes no warranties, express or implied, about
            the availability, reliability, or accuracy of the Service, to the fullest extent permitted by law.
          </p>
          <h4>6. Limitation of Liability</h4>
          <p>
            To the maximum extent permitted by law, EventEase will not be liable for indirect, incidental, special,
            consequential, or punitive damages, or for any loss of profits or data, arising out of or in connection with
            your use of the Service.
          </p>
          <h4>7. Termination</h4>
          <p>
            We may suspend or terminate your access to the Service at any time, with or without notice, if you breach
            these Terms of Use or if we reasonably decide your conduct is harmful to the platform or other users.
          </p>
          <h4>8. Changes to These Terms</h4>
          <p>
            We may update these Terms of Use from time to time. The latest version will always be available on this
            page. Continued use of the Service after changes take effect constitutes acceptance of the updated terms.
          </p>
          <h4>9. Contact</h4>
          <p>Questions about these Terms of Use? Contact the EventEase team via the support channels listed in the footer.</p>
          <p><Link to="/terms-and-conditions" onClick={onClose}>Read the full Terms &amp; Conditions page →</Link></p>
          <p><Link to="/terms" onClick={onClose}>Read the full Terms of Use page →</Link></p>
        </div>

        <div className="terms-modal-actions">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
          {atEnd && (
            <button className="btn btn-dark btn-sm" onClick={() => { onAccept(); onClose(); }}>
              I have read and accept
            </button>
          )}
        </div>
        {!atEnd && (
          <p className="muted small" style={{ textAlign: 'center', margin: '0.4rem 0 0' }}>
            {kind === 'checkout' ? 'Scroll to the end to enable the accept button.' : 'Scroll to the end to enable the accept button.'}
          </p>
        )}
      </div>
    </div>
  );
}