namespace NEvo.Messaging.Cqrs.Commands;

public interface ICommandDispatcher
{
    Task<Either<Exception, Unit>> DispatchAsync(Command command, CancellationToken cancellationToken);
}
