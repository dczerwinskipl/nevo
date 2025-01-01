namespace NEvo.Ddd.EventSourcing.Deciding;

public class Decider<TAggregate, TKey, TCommand, TEvent>(
    IServiceProvider serviceProvider,
    IDecideHandlerFactoryProvider<TAggregate, TKey, TCommand, TEvent> decideHandlerFactoryProvider
) : IDecider<TAggregate, TKey, TCommand, TEvent> 
    where TAggregate : EventSourcedAggregate<TKey>
    where TCommand : EventSourcedCommand<TKey>
    where TEvent : EventSourcedEvent<TKey>
{

    public Task<Either<Exception, IEnumerable<TEvent>>> DecideAsync(TAggregate aggregate, TCommand command, CancellationToken cancellationToken)
    {
        var factory = decideHandlerFactoryProvider.GetHandlerFactory(command.GetType());
        var handler = factory(serviceProvider);
        return handler(aggregate, command, cancellationToken);
    }
}
