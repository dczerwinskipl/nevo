using NEvo.Messaging.Context;
using NEvo.Messaging.Events;

namespace NEvo.Ddd.EventSourcing.Executing;

public class EventSourcedCommandExecutor(IAggregateRepository repository, IEventPublisher eventPublisher) : IEventSourcedCommandExecutor
{
    private readonly IAggregateRepository _repository = repository;
    private readonly IEventPublisher _eventPublisher = eventPublisher;

    public EitherAsync<Exception, Unit> ExecuteAsync<TCommand, TAggregate, TId>(
        TCommand command,
        IMessageContext context,
        IAggregateAuthorization<TCommand, TAggregate, TId> authorization,
        Func<Option<TAggregate>, EitherAsync<Exception, IEnumerable<IAggregateEvent<TAggregate, TId>>>> decide,
        CancellationToken cancellationToken)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
        => from loaded in _repository.LoadAggregateAsync<TAggregate, TId>(command.StreamId, cancellationToken)
           from _ in authorization.AuthorizeAsync(command, loaded.Map(l => l.Aggregate), context, cancellationToken)
           from events in decide(loaded.Map(l => l.Aggregate))
           from __ in AppendAndPublish(command.StreamId, loaded, events, cancellationToken)
           select Unit.Default;

    // Append must complete before synchronous event publication, so a downstream
    // handler that reloads the aggregate observes the newly appended state.
    private EitherAsync<Exception, Unit> AppendAndPublish<TAggregate, TId>(
        TId streamId,
        Option<(TAggregate Aggregate, int Version)> loaded,
        IEnumerable<IAggregateEvent<TAggregate, TId>> events,
        CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        var eventList = events.ToList();
        var expectedState = loaded.Match(
            Some: l => ExpectedStreamState.Exact(l.Version),
            None: () => ExpectedStreamState.NoStream
        );

        return from _ in _repository.AppendEventsAsync(streamId, eventList, expectedState, cancellationToken)
               from __ in PublishAll(eventList, cancellationToken)
               select Unit.Default;
    }

    private EitherAsync<Exception, Unit> PublishAll<TAggregate, TId>(IEnumerable<IAggregateEvent<TAggregate, TId>> events, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
        => PublishAllAsync(events, cancellationToken).ToAsync();

    private async Task<Either<Exception, Unit>> PublishAllAsync<TAggregate, TId>(IEnumerable<IAggregateEvent<TAggregate, TId>> events, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        foreach (var @event in events)
        {
            var result = await _eventPublisher.PublishAsync((Event)@event, cancellationToken);
            if (result.IsLeft)
            {
                return result;
            }
        }

        return Unit.Default;
    }
}
