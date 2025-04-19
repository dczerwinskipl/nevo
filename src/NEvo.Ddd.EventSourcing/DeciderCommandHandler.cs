using LanguageExt;

namespace NEvo.Ddd.EventSourcing;

public class DeciderCommandHandler(
    IDeciderRegistry deciderRegistry,
    IEventStore eventStore
) : IDeciderCommandHandler
{
    public EitherAsync<Exception, Unit> HandleAsync<TCommand, TAggregate, TEvent, TId>(TCommand command, CancellationToken cancellationToken)
        where TCommand : AggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TEvent : AggregateEvent<TAggregate, TId>
        where TId : notnull
        => from decider in deciderRegistry.GetDecider<TCommand, TAggregate, TId>(command)
                .ToEitherAsync(() => new Exception($"No decider found for command {command.GetType().Name}"))
           from aggregate in eventStore
                    .LoadAggregateAsync<TAggregate, TId>(command.StreamId, cancellationToken)
                    .Match(x => x, () => EmptyWhenInit<TCommand, TAggregate, TId>(command))
                    .ToEitherAsync(() => new Exception($"No aggregate found for command {command.GetType().Name}"))
           from events in decider.DecideAsync<TCommand, TAggregate, TEvent, TId>(command, aggregate, cancellationToken)
           from result in eventStore.AppendEventsAsync<TEvent, TAggregate, TId>(aggregate.Id, events, cancellationToken)
           select result;

    private Option<TAggregate> EmptyWhenInit<TCommand, TAggregate, TId>(TCommand command)
        where TCommand : AggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TId : notnull
        => command is ICreateAggregateCommand ? TAggregate.CreateEmpty(command.StreamId) : Option<TAggregate>.None;
}

