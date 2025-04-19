using System.Security.Cryptography;

namespace NEvo.Ddd.EventSourcing.Deciding;

/// <summary>
/// Decider that use Aggregate instance to handle the command.
/// </summary>
public class AggregateDecider : IDecider
{
    public AggregateDecider()
    {

    }

    public EitherAsync<Exception, IEnumerable<TEvent>> DecideAsync<TCommand, TAggregate, TEvent, TId>(TCommand command, TAggregate aggregate, CancellationToken cancellationToken)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TEvent : Event, IAggregateEvent<TAggregate, TId>
        where TId : notnull
    {
        var x = from decider in GetDecider<TCommand, TAggregate, TEvent, TId>().ToEitherAsync(
                   () => new Exception($"No decider found for command {command.GetType().Name} on aggregate {aggregate.GetType().Name}")
                )
                from events in decider(aggregate, command)
                select events;

        return x;
    }

    delegate Either<Exception, TEvent[]> Decide<TCommand, TAggregate, TEvent, TId>(TAggregate aggregate, TCommand command)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TEvent : Event, IAggregateEvent<TAggregate, TId>
        where TId : notnull;

    private static readonly IDictionary<Type, Delegate> _deciders = new Dictionary<Type, Delegate>();

    private static Option<Decide<TCommand, TAggregate, TEvent, TId>> GetDecider<TCommand, TAggregate, TEvent, TId>()
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TEvent : Event, IAggregateEvent<TAggregate, TId>
        where TId : notnull =>
        _deciders
            .TryGetValue(typeof(TCommand))
            .ToOption()
            .Bind<Decide<TCommand, TAggregate, TEvent, TId>>(
                obj => obj as Decide<TCommand, TAggregate, TEvent, TId>
            );
}

// we need some cache I guess