using System.Diagnostics;

namespace NEvo.Ddd.EventSourcing.Deciding;

/// <summary>
/// Decider that use Aggregate instance to handle the command.
/// </summary>
public class AggregateDecider : IDecider
{
    public delegate Either<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>> DecideDelegate<TAggregate, TId>(TAggregate aggregate, IAggregateCommand<TAggregate, TId> command)
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull;

    private static IDictionary<Type, List<(Type AggregateType, Delegate Decide)>> _deciders = null!;

    // TODO: add DI with some registry?
    // TODO: and/or replace Type with some options
    public AggregateDecider(Type[] aggregateTypes)
    {
        _deciders ??= aggregateTypes
            .SelectMany(AggregateDeciderExtractor.ExtractDeciders)
            .GroupBy(
                decider => decider.Item1,
                decider => (decider.Item2, decider.Item3)
            )
            .ToDictionary(
                deciders => deciders.Key,
                deciders => deciders.ToList()
            );
    }

    public EitherAsync<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>> DecideAsync<TAggregate, TId>(TAggregate aggregate, IAggregateCommand<TAggregate, TId> command, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull
            => from decider in GetDecider(aggregate, command)
                    .ToEitherAsync(() => new Exception($"No decider found for command {command.GetType().Name} on aggregate {aggregate.GetType().Name}"))
               from events in decider(aggregate, command).ToAsync()
               select events;

    private static Option<DecideDelegate<TAggregate, TId>> GetDecider<TAggregate, TId>(TAggregate aggregate, IAggregateCommand<TAggregate, TId> command)
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull =>
        _deciders
            .TryGetValue(command.GetType())
            .SelectMany(x => x)
            .Where(decider => decider.AggregateType.IsAssignableFrom(aggregate.GetType()))
            .ToOption()
            .Bind<DecideDelegate<TAggregate, TId>>(
                decider => decider.Decide as DecideDelegate<TAggregate, TId>
            );
}
