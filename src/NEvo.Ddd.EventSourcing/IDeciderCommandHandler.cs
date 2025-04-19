using LanguageExt;

namespace NEvo.Ddd.EventSourcing;

public interface IDeciderCommandHandler
{
    public EitherAsync<Exception, Unit> HandleAsync<TCommand, TAggregate, TEvent, TId>(TCommand command, CancellationToken cancellationToken)
        where TCommand : AggregateCommand<TAggregate, TId>
        where TAggregate : IAggregateRoot<TId, TAggregate>
        where TEvent : AggregateEvent<TAggregate, TId>
        where TId : notnull;
}
