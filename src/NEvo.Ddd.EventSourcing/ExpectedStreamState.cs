namespace NEvo.Ddd.EventSourcing;

/// <summary>
/// Replaces a bare expected-version integer with an explicit creation-vs-mutation
/// intent (D29): <see cref="NoStream"/> is valid only if the stream does not yet exist;
/// <see cref="Exact"/> is valid only if the stream is at exactly the given version. No
/// unconditional-append ("Any") case exists by design.
/// </summary>
public abstract record ExpectedStreamState
{
    private ExpectedStreamState() { }

    public sealed record NoStreamState : ExpectedStreamState;

    public sealed record ExactState(int Version) : ExpectedStreamState;

    public static ExpectedStreamState NoStream { get; } = new NoStreamState();

    public static ExpectedStreamState Exact(int version) => new ExactState(version);
}
