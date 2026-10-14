import React from 'react';
import { Link } from 'react-router-dom';

export default function TermsOfUse() {
  return (
    <div className="container narrow">
      <h1>Terms of Use</h1>
      <p className="muted">Last updated: September 2026</p>
      <p>
        Welcome to EventEase (operated by eventease_grp6, NTU Group 6). These Terms of Use govern your access to and
        use of the EventEase website and services (the “Service”). By creating an account, browsing events, or making a
        purchase, you agree to be bound by these terms.
      </p>

      <h2>1. Use of the Service</h2>
      <p>
        EventEase provides a ticketing platform for events such as concerts, theatre, sports and cultural activities.
        You agree to use the Service only for lawful purposes and in a way that does not infringe the rights of others
        or restrict anyone else from enjoying the Service.
      </p>

      <h2>2. Accounts</h2>
      <p>
        You are responsible for the accuracy of the information you provide when registering and for safeguarding your
        account credentials. You must notify us immediately of any unauthorised use of your account. We may suspend or
        terminate accounts that violate these terms or the safety of other users.
      </p>

      <h2>3. Acceptable Conduct</h2>
      <p>You must not use the Service to:</p>
      <ul>
        <li>engage in fraudulent activity, including chargeback abuse or scalping that violates platform rules;</li>
        <li>misuse, hack, or attempt to disrupt the Service or its data;</li>
        <li>post false or misleading event information;</li>
        <li>attempt to gain unauthorised access to other users’ accounts or the platform.</li>
      </ul>

      <h2>4. Intellectual Property</h2>
      <p>
        All content on the Service — including text, graphics, logos, event listings and software — is the property of
        EventEase or its licensors and is protected by applicable intellectual property laws. You may not reproduce,
        distribute, or create derivative works without prior written permission.
      </p>

      <h2>5. Disclaimer of Warranties</h2>
      <p>
        The Service is provided “as is” and “as available”. EventEase makes no warranties, express or implied, about the
        availability, reliability, or accuracy of the Service, to the fullest extent permitted by law.
      </p>

      <h2>6. Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by law, EventEase will not be liable for indirect, incidental, special,
        consequential, or punitive damages, or for any loss of profits or data, arising out of or in connection with
        your use of the Service.
      </p>

      <h2>7. Termination</h2>
      <p>
        We may suspend or terminate your access to the Service at any time, with or without notice, if you breach these
        Terms of Use or if we reasonably decide your conduct is harmful to the platform or other users.
      </p>

      <h2>8. Changes to These Terms</h2>
      <p>
        We may update these Terms of Use from time to time. The latest version will always be available on this page.
        Continued use of the Service after changes take effect constitutes acceptance of the updated terms.
      </p>

      <h2>9. Contact</h2>
      <p>
        Questions about these Terms of Use? Contact the EventEase team via the support channels listed in the footer.
      </p>

      <p className="muted small"><Link to="/">← Back to browse events</Link></p>
    </div>
  );
}