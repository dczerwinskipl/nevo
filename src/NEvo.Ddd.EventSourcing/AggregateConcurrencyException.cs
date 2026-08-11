namespace NEvo.Ddd.EventSourcing;

/// <summary>
/// Represents an optimistic-concurrency conflict on stream append. Returned through
/// NEvo's normal error-result flow (<c>Either&lt;Exception, Unit&gt;.Left</c>) — never
/// thrown.
/// </summary>
public class AggregateConcurrencyException(string streamId, ExpectedStreamState expectedState, int actualVersion)
    : Exception($"Concurrency conflict appending to stream '{streamId}': expected {Describe(expectedState)}, but the stream is currently at version {actualVersion}.")
{
    public string StreamId { get; } = streamId;
    public ExpectedStreamState ExpectedState { get; } = expectedState;
    public int ActualVersion { get; } = actualVersion;

    private static string Describe(ExpectedStreamState expectedState) => expectedState switch
    {
        ExpectedStreamState.NoStreamState => "the stream not to exist yet",
        ExpectedStreamState.ExactState exact => $"version {exact.Version}",
        _ => expectedState.ToString() ?? expectedState.GetType().Name
    };
}
