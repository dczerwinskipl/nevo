using NEvo.Messaging.Cqrs.Commands;

namespace NEvo.ExampleApp.ExampleDomain
{
    public record MyCommand : Command
    {
        public string Foo { get; init; }

        public MyCommand(string foo) : base()
        {
            Foo = foo;
        }

        public MyCommand(Guid id, DateTime createdAt, string foo) : base(id, createdAt)
        {
            Foo = foo;
        }
    }
}