namespace NEvo.Ddd.EventSourcing.Deciding;

public class AggregateExtractorConfiguration
{
    public System.Collections.Generic.HashSet<Type> AggregateTypes { get; } = new();
}
