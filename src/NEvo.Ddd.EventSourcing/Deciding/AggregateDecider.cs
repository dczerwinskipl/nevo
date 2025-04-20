using System.Diagnostics;

namespace NEvo.Ddd.EventSourcing.Deciding;

/// <summary>
/// Decider that use Aggregate instance to handle the command.
/// </summary>
public class AggregateDecider : IDecider
{
    public delegate Either<Exception, IEnumerable<TEvent>> Decide<TCommand, TAggregate, TEvent, TId>(TAggregate aggregate, TCommand command)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TEvent : Event, IAggregateEvent<TAggregate, TId>
        where TId : notnull;

    private static IDictionary<Type, (Type AggregateType, Delegate Decide)> _deciders = null!;

    // TODO: add DI with some registry?
    // TODO: and/or replace Type with some options
    public AggregateDecider(Type[] aggregateTypes)
    {
        _deciders ??= aggregateTypes
            .SelectMany(AggregateDeciderExtractor.ExtractDeciders)
            .ToDictionary(
                decider => decider.Item1,
                decider => (decider.Item2, decider.Item3)
            );
    }

    public EitherAsync<Exception, IEnumerable<TEvent>> DecideAsync<TCommand, TAggregate, TEvent, TId>(TCommand command, TAggregate aggregate, CancellationToken cancellationToken)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TEvent : Event, IAggregateEvent<TAggregate, TId>
        where TId : notnull
            => from decider in GetDecider<TCommand, TAggregate, TEvent, TId>(aggregate)
                    .ToEitherAsync(() => new Exception($"No decider found for command {command.GetType().Name} on aggregate {aggregate.GetType().Name}"))
               from events in decider(aggregate, command).ToAsync()
               select events;

    private static Option<Decide<TCommand, TAggregate, TEvent, TId>> GetDecider<TCommand, TAggregate, TEvent, TId>(TAggregate aggregate)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TEvent : Event, IAggregateEvent<TAggregate, TId>
        where TId : notnull =>
        _deciders
            .TryGetValue(typeof(TCommand))
            .ToOption()
            .Where(decider => aggregate.GetType().IsAssignableFrom(decider.AggregateType))
            .Bind<Decide<TCommand, TAggregate, TEvent, TId>>(
                decider => decider.Decide as Decide<TCommand, TAggregate, TEvent, TId>
            );
}
