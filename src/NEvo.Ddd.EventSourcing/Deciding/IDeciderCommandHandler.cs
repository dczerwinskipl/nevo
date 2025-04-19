using LanguageExt;

namespace NEvo.Ddd.EventSourcing.Deciding;

public interface IDeciderCommandHandler
{
    public EitherAsync<Exception, Unit> HandleAsync<TCommand, TAggregate, TEvent, TId>(TCommand command, CancellationToken cancellationToken)
        where TCommand : Command, IAggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TEvent : Event, IAggregateEvent<TAggregate, TId>
        where TId : notnull;
}
