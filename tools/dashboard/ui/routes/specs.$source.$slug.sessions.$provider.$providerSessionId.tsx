import { createFileRoute } from '@tanstack/react-router';
import { AgentSessionScreen } from '@/screens/agent-session-screen';

export const Route = createFileRoute('/specs/$source/$slug/sessions/$provider/$providerSessionId')({
  component: AgentSessionRouteEntry,
});

function AgentSessionRouteEntry() {
  const { source, slug, provider, providerSessionId } = Route.useParams();
  return <AgentSessionScreen source={source} slug={slug} provider={provider} providerSessionId={providerSessionId} />;
}
