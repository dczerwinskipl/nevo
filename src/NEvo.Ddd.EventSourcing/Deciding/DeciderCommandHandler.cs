namespace NEvo.Ddd.EventSourcing.Deciding;

public class DeciderCommandHandler(
    IDeciderRegistry deciderRegistry,
    IEventStore eventStore
) : IDeciderCommandHandler
{
    public EitherAsync<Exception, Unit> HandleAsync<TCommand, TAggregate, TEvent, TId>(TCommand command, CancellationToken cancellationToken)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TEvent : Event, IAggregateEvent<TAggregate, TId>
        where TId : notnull
        => from decider in GetDecider<TCommand, TAggregate, TId>(command)
           from aggregate in GetAggregate<TCommand, TAggregate, TId>(command, cancellationToken)
           from events in decider.DecideAsync(aggregate, command, cancellationToken)
           from result in eventStore.AppendEventsAsync(aggregate.Id, events, cancellationToken)
           select result;

    private EitherAsync<Exception, IDecider> GetDecider<TCommand, TAggregate, TId>(TCommand command)
            where TCommand : Command, IAggregateCommand<TAggregate, TId>
            where TAggregate : IAggregateRoot<TId, TAggregate>
            where TId : notnull
            => deciderRegistry
                .GetDecider<TCommand, TAggregate, TId>(command)
                .ToEitherAsync(() => new Exception($"No decider found for command {command.GetType().Name}"));

    private EitherAsync<Exception, TAggregate> GetAggregate<TCommand, TAggregate, TId>(TCommand command, CancellationToken cancellationToken)
        where TCommand : IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull
        => eventStore
            .LoadAggregateAsync<TAggregate, TId>(command.StreamId, cancellationToken)
            .Match(
                Some: aggregate => aggregate,
                None: () => GetEmptyAggregateForCreateCommand<TCommand, TAggregate, TId>(command))
            .ToEitherAsync(() => new Exception($"No aggregate found for command {command.GetType().Name}"));

    private Option<TAggregate> GetEmptyAggregateForCreateCommand<TCommand, TAggregate, TId>(TCommand command)
        where TCommand : IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull
        => command is ICreateAggregateCommand<TAggregate, TId>
            ? TAggregate.CreateEmpty(command.StreamId)
            : Option<TAggregate>.None;
}

