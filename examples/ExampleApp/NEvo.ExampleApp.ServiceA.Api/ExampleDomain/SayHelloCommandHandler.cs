using LanguageExt;
using NEvo.Messaging.Authorization;
using NEvo.Messaging.Context;

namespace NEvo.ExampleApp.ServiceA.Api.ExampleDomain;

public class SayHelloCommandHandler(IEventPublisher eventPublisher) : ICommandHandler<SayHelloCommand>
{
    [AllowPermission(Permissions.SayHello, typeof(SayDataScopeValidator<SayHelloCommand>))]
    public async Task<Either<Exception, Unit>> HandleAsync(SayHelloCommand message, IMessageContext messageContext, CancellationToken cancellationToken)
    {
        Console.WriteLine(message.Foo);

        return await eventPublisher.PublishAsync(new MyEvent(message.Foo), cancellationToken);
    }
}