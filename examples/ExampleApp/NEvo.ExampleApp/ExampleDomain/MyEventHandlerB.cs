using LanguageExt;
using NEvo.Messaging.Context;

namespace NEvo.ExampleApp.ExampleDomain;

public class MyEventHandlerB : IEventHandler<MyEvent>
{
    public Task<Either<Exception, Unit>> HandleAsync(MyEvent message, IMessageContext messageContext, CancellationToken cancellationToken)
    {
        Console.WriteLine($"HandlerB: {message.Foo}");
        if (message.Foo.Equals("Exception", StringComparison.CurrentCultureIgnoreCase))
            throw new Exception(message.Foo);

        return UnitExt.DefaultEitherTask;
    }
}