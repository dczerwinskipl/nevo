namespace NEvo.Ddd.EventSourcing.Deciding;

public interface IAggregateDeciderProvider
{
    public IDictionary<Type, List<(Type AggregateType, Type DeclaringType, Type IdType, Delegate Decide)>> GetAggregateDeciders();
}
