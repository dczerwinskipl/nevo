namespace NEvo.Ddd.EventSourcing;

/// <summary>
/// Configures <c>AddEventSourcing</c>. Kept flat — one toggle for the one
/// configurable behavior that currently exists; extend to a richer shape only when a
/// second, independent configuration group actually appears.
/// </summary>
public sealed class EventSourcingOptions
{
    /// <summary>
    /// Whether the aggregate-method convention is registered as a fallback route for
    /// commands with no explicit handler. Enabled by default.
    /// </summary>
    public bool UseAggregateMethodFallback { get; set; } = true;
}
