import { createFileRoute } from '@tanstack/react-router';
import { AgentSessionRoute } from '@/features/agent-sessions/agent-session-route';

export const Route = createFileRoute(
  '/specs/$source/$slug/sessions/$provider/$providerSessionId',
)({
  component: AgentSessionRouteEntry,
});

function AgentSessionRouteEntry() {
  const { source, slug, provider, providerSessionId } = Route.useParams();
  return (
    <AgentSessionRoute
      source={source}
      slug={slug}
      provider={provider}
      providerSessionId={providerSessionId}
    />
  );
}
