namespace NEvo.Ddd.EventSourcing.Deciding;

public class DeciderCommandHandler<TCommand, TAggregate, TId>(
    IDeciderRegistry deciderRegistry,
    IEventStore eventStore
)
    where TCommand : Command, IAggregateCommand<TAggregate, TId>
    where TAggregate : IAggregateRoot<TId, TAggregate>
    where TId : notnull
{
    public EitherAsync<Exception, Unit> HandleAsync(TCommand command, CancellationToken cancellationToken)
        => from decider in GetDecider(command)
           from aggregate in GetAggregate(command, cancellationToken)
           from events in decider.DecideAsync(aggregate, command, cancellationToken)
           from result in eventStore.AppendEventsAsync(aggregate.Id, events, cancellationToken)
           select result;

    private EitherAsync<Exception, IDecider> GetDecider(TCommand command)
            => deciderRegistry
                .GetDecider<TCommand, TAggregate, TId>(command)
                .ToEitherAsync(() => new Exception($"No decider found for command {command.GetType().Name}"));

    private EitherAsync<Exception, TAggregate> GetAggregate(TCommand command, CancellationToken cancellationToken)
        => eventStore
            .LoadAggregateAsync<TAggregate, TId>(command.StreamId, cancellationToken)
            .Match(
                Some: aggregate => aggregate,
                None: () => GetEmptyAggregateForCreateCommand(command))
            .ToEitherAsync(() => new Exception($"No aggregate found for command {command.GetType().Name}"));

    private Option<TAggregate> GetEmptyAggregateForCreateCommand(TCommand command)
        => command is ICreateAggregateCommand<TAggregate, TId>
            ? TAggregate.CreateEmpty(command.StreamId)
            : Option<TAggregate>.None;
}

