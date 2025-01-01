using LanguageExt;

namespace NEvo.Ddd.EventSourcing.Deciding;

public delegate Task<Either<Exception, IEnumerable<TEvent>>> DecideAsyncHandler<TAggregate, TKey, TCommand, TEvent>(TAggregate aggregate, TCommand command, CancellationToken cancellationToken)
    where TAggregate : EventSourcedAggregate<TKey>
    where TEvent : EventSourcedEvent<TKey>
    where TCommand : EventSourcedCommand<TKey>;

public delegate DecideAsyncHandler<TAggregate, TKey, TCommand, TEvent> DecideAsyncHandlerFactory<TAggregate, TKey, TCommand, TEvent>(IServiceProvider serviceProvider)
    where TAggregate : EventSourcedAggregate<TKey>
    where TEvent : EventSourcedEvent<TKey>
    where TCommand : EventSourcedCommand<TKey>;

public interface IDecideHandlerFactoryProvider<TAggregate, TKey, TCommand, TEvent>
    where TAggregate : EventSourcedAggregate<TKey>
    where TEvent : EventSourcedEvent<TKey>
    where TCommand : EventSourcedCommand<TKey>
{
    DecideAsyncHandlerFactory<TAggregate, TKey, TCommand, TEvent> GetHandlerFactory(Type commandType);
    
    IEnumerable<Type> GetCommandTypes();
}
