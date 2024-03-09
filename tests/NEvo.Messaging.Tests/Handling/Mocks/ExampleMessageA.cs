namespace NEvo.Messaging.Tests.Handling.Mocks;

public record ExampleMessageA : ExampleMessage
{
    public ExampleMessageA()
    {
    }

    public ExampleMessageA(Guid Id, DateTime CreatedAt) : base(Id, CreatedAt)
    {
    }
}
