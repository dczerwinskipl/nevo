namespace NEvo.Messaging.Handling;

/// <summary>
/// Distinguishes an intentional convention fallback from a genuine duplicate-handler
/// conflict (D3) — no numeric priority. One Primary wins over any Fallback; two or more
/// candidates in the same role for the same message type is a configuration error.
/// </summary>
public enum HandlerRole
{
    Primary,
    Fallback
}
