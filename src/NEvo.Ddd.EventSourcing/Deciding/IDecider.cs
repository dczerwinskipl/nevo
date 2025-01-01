using LanguageExt;

namespace NEvo.Ddd.EventSourcing.Deciding;

public interface IDecider<TAggregate, TKey, TCommand, TEvent>
    where TAggregate : EventSourcedAggregate<TKey>
    where TCommand : EventSourcedCommand<TKey>
    where TEvent : EventSourcedEvent<TKey>
{
    Task<Either<Exception, IEnumerable<TEvent>>> DecideAsync(TAggregate aggregate, TCommand command, CancellationToken cancellationToken);
}