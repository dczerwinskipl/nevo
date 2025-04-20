namespace NEvo.Ddd.EventSourcing.Deciding;

public record DeciderDescription
{
    public required Type CommandType { get; init; }
    public required Type AggregateType { get; init; }
    public required Type DeclaringType { get; init; }
    public required Type IdType { get; init; }
    public required Type DeciderType { get; init; }

    public override string ToString()
    {
        return $"{CommandType.Name}-{AggregateType.Name}-{DeciderType.Name}";
    }
}