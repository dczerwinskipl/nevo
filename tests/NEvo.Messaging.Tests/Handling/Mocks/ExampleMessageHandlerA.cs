namespace NEvo.Messaging.Tests.Handling.Mocks;

public class ExampleMessageHandlerA : IExampleMessageHandler<ExampleMessageA>
{
    public void Handle(ExampleMessageA message)
    {
        throw new NotImplementedException();
    }
}
