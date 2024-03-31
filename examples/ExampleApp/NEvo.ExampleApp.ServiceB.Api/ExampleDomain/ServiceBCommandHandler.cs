using LanguageExt;
using NEvo.Messaging.Context;

namespace NEvo.ExampleApp.ServiceB.Api.ExampleDomain;

public class ServiceBCommandHandler : ICommandHandler<ServiceBCommand>
{
    public Task<Either<Exception, Unit>> HandleAsync(ServiceBCommand message, IMessageContext messageContext, CancellationToken cancellationToken)
    {
        Console.WriteLine(message.Foo);

        return UnitExt.DefaultEitherTask;
    }
}