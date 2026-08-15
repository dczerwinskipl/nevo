namespace NEvo.Messaging.Handling;

/// <summary>
/// Distinguishes an intentional fallback route from a genuine duplicate-handler
/// conflict — no numeric priority. <see cref="Primary"/> is an explicit handler
/// candidate; <see cref="Fallback"/> is considered only when no <see cref="Primary"/>
/// candidate exists for the same message type. Multiple candidates at the effective
/// role are a configuration error.
/// </summary>
public enum HandlerRole
{
    Primary,
    Fallback
}
