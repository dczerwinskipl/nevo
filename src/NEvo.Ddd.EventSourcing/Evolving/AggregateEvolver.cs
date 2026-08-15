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
               from result in evolver(aggregateOption, @event)
               select result;
    }

    private Either<Exception, EvolveDelegate<TAggregate, TId>> GetEvolverDelegate<TAggregate, TId>(Type aggregateType, IAggregateEvent<TAggregate, TId> @event)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        var candidates = _evolvers
            .TryGetValue(@event.GetType())
            .Map(matches => matches.Where(decider => decider.AggregateType.IsAssignableFrom(aggregateType)).ToList())
            .IfNone([]);

        return MostSpecificCandidateResolver.Resolve(
            candidates,
            candidate => candidate.AggregateType,
            notFound: () => new Exception($"No evolver found for event {@event.GetType().Name} on aggregate {aggregateType.Name}"),
            ambiguous: tied => new Exception(
                $"Ambiguous evolver for event {@event.GetType().Name} on aggregate {aggregateType.Name}: " +
                $"{tied.Count} equally-specific candidates found, declared on {string.Join(", ", tied.Select(t => t.AggregateType.Name))}."
            )
        ).Bind(candidate => CastDelegate<TAggregate, TId>(candidate, aggregateType, @event));
    }

    private static Either<Exception, EvolveDelegate<TAggregate, TId>> CastDelegate<TAggregate, TId>(
        (Type AggregateType, Delegate Decide) candidate,
        Type aggregateType,
        IAggregateEvent<TAggregate, TId> @event)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        if (candidate.Decide is EvolveDelegate<TAggregate, TId> typed)
        {
            return typed;
        }

        return new Exception($"Evolver for event {@event.GetType().Name} on aggregate {aggregateType.Name} has an unexpected delegate shape.");
    }

    public bool CanHandle<TAggregate, TId>()
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull => _aggregateTypes.Contains(typeof(TAggregate));

}