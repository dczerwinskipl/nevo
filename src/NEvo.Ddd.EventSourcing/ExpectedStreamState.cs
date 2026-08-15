namespace NEvo.Ddd.EventSourcing;

/// <summary>
/// The expected state of a stream at append time. <see cref="NoStream"/> expresses a
/// create-only append, valid only if the stream does not yet exist.
/// <see cref="Exact"/> expresses optimistic concurrency against an observed version,
/// valid only if the stream is at exactly that version. There is no unconditional-append
/// case.
/// </summary>
public abstract record ExpectedStreamState
{
    private ExpectedStreamState() { }

    public sealed record NoStreamState : ExpectedStreamState;

    public sealed record ExactState(int Version) : ExpectedStreamState;

    public static ExpectedStreamState NoStream { get; } = new NoStreamState();

    public static ExpectedStreamState Exact(int version) => new ExactState(version);
}
