<script lang="ts">
  import Page from '$lib/components/page.svelte';

  const updatedAt = 'January 15, 2026';
</script>

<Page title="Terms of Use" description="The terms that govern your use of Tribunal.">
  <div class="prose">
    <p>Last updated: {updatedAt}</p>

    <h2>Acceptance of terms</h2>
    <p>
      By accessing or using Tribunal, you agree to these Terms of Use. If you do not agree, do not
      use the service.
    </p>

    <h2>Eligibility and accounts</h2>
    <p>
      You are responsible for maintaining the confidentiality of your account and for all activity
      that occurs under your account.
    </p>

    <h2>Acceptable use</h2>
    <ul>
      <li>Use Tribunal only for lawful purposes.</li>
      <li>Do not attempt to disrupt or compromise the service.</li>
      <li>Do not misuse integrations or access unauthorized data.</li>
    </ul>

    <h2>Content</h2>
    <p>
      You retain ownership of content you submit to Tribunal. You grant Tribunal a license to host,
      store, and process that content solely to operate and improve the service.
    </p>

    <h2>Intellectual property</h2>
    <p>
      Tribunal and its logos, designs, and software are owned by Tribunal and are protected by
      intellectual property laws. You may not copy or reverse engineer the service.
    </p>

    <h2>Third-party services</h2>
    <p>
      Tribunal may link to or integrate with third-party services. Your use of those services is
      governed by their terms and policies.
    </p>

    <h2>Termination</h2>
    <p>
      We may suspend or terminate access to Tribunal if you violate these terms or if we discontinue
      the service. You can stop using Tribunal at any time.
    </p>

    <h2>Disclaimers</h2>
    <p>
      Tribunal is provided "as is" without warranties of any kind. We do not guarantee that the
      service will be uninterrupted or error-free.
    </p>

    <h2>Limitation of liability</h2>
    <p>
      To the maximum extent permitted by law, Tribunal will not be liable for indirect, incidental,
      or consequential damages arising from your use of the service.
    </p>

    <h2>Changes to terms</h2>
    <p>
      We may update these terms from time to time. Continued use of Tribunal after changes become
      effective constitutes acceptance of the updated terms.
    </p>

    <h2>Contact</h2>
    <p>
      Questions about these terms can be sent to
      <a href="mailto:support@tribunal.dev">support@tribunal.dev</a>.
    </p>
  </div>
</Page>
