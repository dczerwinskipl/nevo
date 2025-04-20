namespace NEvo.Ddd.EventSourcing.Evolving;

public class AggregateEvolver : IEvolver
{
    public delegate TAggregate EvolveDelegate<TAggregate, TId>(TAggregate aggregate, IAggregateEvent<TAggregate, TId> @event)
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull;

    private static IDictionary<Type, List<(Type AggregateType, Delegate Decide)>> _evolvers = null!;

    // TODO: add DI with some registry?
    // TODO: and/or replace Type with some options
    public AggregateEvolver(Type[] aggregateTypes)
    {
        _evolvers ??= aggregateTypes
            .SelectMany(AggregateEvolverExtractor.ExtractEvolvers)
            .GroupBy(
                decider => decider.EventType,
                decider => (decider.DeclaringType, decider.Decider)
            )
            .ToDictionary(
                deciders => deciders.Key,
                deciders => deciders.ToList()
            );
    }

    public Either<Exception, TAggregate> Evolve<TAggregate, TId>(TAggregate aggregate, IAggregateEvent<TAggregate, TId> @event)
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull
            => from evolve in GetEvolver(aggregate, @event)
                    .ToEither(() => new Exception($"No evolver found for event {@event.GetType().Name} on aggregate {aggregate.GetType().Name}"))
               select evolve(aggregate, @event);

    private static Option<EvolveDelegate<TAggregate, TId>> GetEvolver<TAggregate, TId>(TAggregate aggregate, IAggregateEvent<TAggregate, TId> @event)
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull =>
        _evolvers
            .TryGetValue(@event.GetType())
            .SelectMany(x => x)
            .Where(decider => decider.AggregateType.IsAssignableFrom(aggregate.GetType()))
            .ToOption()
            .Bind<EvolveDelegate<TAggregate, TId>>(
                decider =>
                {
                    var x = decider.Decide as EvolveDelegate<TAggregate, TId>;
                    return x;
                }
            );
}