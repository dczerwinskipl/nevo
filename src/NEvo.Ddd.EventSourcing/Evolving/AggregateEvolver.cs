using Microsoft.Extensions.Options;
using NEvo.Ddd.EventSourcing.Deciding;

namespace NEvo.Ddd.EventSourcing.Evolving;

public class AggregateEvolver : IEvolver
{
    public delegate Either<Exception, TAggregate> EvolveDelegate<TAggregate, TId>(Option<TAggregate> aggregate, IAggregateEvent<TAggregate, TId> @event)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull;

    private readonly System.Collections.Generic.HashSet<Type> _aggregateTypes;
    private readonly IDictionary<Type, List<(Type AggregateType, Delegate Decide)>> _evolvers;

    public AggregateEvolver(IOptions<AggregateExtractorConfiguration> options)
    {
        _aggregateTypes = options.Value.AggregateTypes.ToHashSet(); ;
        _evolvers = _aggregateTypes
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

    public Either<Exception, TAggregate> Evolve<TAggregate, TId>(Option<TAggregate> aggregateOption, IAggregateEvent<TAggregate, TId> @event)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        var aggregateType = aggregateOption.Map(a => a.GetType()).IfNone(typeof(TAggregate));
        return from evolver in GetEvolverDelegate(aggregateType, @event)
                    .ToEither(() => new Exception($"No evolver found for event {@event.GetType().Name} on aggregate {aggregateType.Name}"))
               from result in evolver(aggregateOption, @event)
               select result;
    }

    private Option<EvolveDelegate<TAggregate, TId>> GetEvolverDelegate<TAggregate, TId>(Type aggregateType, IAggregateEvent<TAggregate, TId> @event)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull =>
        _evolvers
            .TryGetValue(@event.GetType())
            .SelectMany(x => x)
            .Where(decider => decider.AggregateType.IsAssignableFrom(aggregateType))
            .ToOption()
            .Bind<EvolveDelegate<TAggregate, TId>>(
                decider =>
                {
                    var x = decider.Decide as EvolveDelegate<TAggregate, TId>;
                    return x;
                }
            );

    public bool CanHandle<TAggregate, TId>()
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull => _aggregateTypes.Contains(typeof(TAggregate));

}