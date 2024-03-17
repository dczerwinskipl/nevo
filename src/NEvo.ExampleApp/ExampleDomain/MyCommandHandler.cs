using LanguageExt;

namespace NEvo.ExampleApp.ExampleDomain;

public class MyCommandHandler : ICommandHandler<MyCommand>
{
    public Task<Either<Exception, Unit>> HandleAsync(MyCommand message, IMessageContext messageContext, CancellationToken cancellationToken)
    {
        Console.WriteLine(message.Foo);

        return UnitExt.DefaultEitherTask;
    }
}