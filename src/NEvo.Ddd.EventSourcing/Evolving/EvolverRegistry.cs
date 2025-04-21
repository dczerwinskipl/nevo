namespace NEvo.Ddd.EventSourcing.Evolving;

public class EvolverRegistry(IEnumerable<IEvolver> evolvers) : IEvolverRegistry
{
    private readonly IEnumerable<IEvolver> _evolvers = evolvers;

    public Option<IEvolver> GetEvolver<TAggregate, TId>()
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
        => _evolvers
            .Where(e => e.CanHandle<TAggregate, TId>())
            .ToOption();
}