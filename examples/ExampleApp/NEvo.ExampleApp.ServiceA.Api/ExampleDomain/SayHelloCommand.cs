using System.Text.Json.Serialization;

namespace NEvo.ExampleApp.ServiceA.Api.ExampleDomain;

public record SayHelloCommand : Command, ISayCommand
{
    public string Foo { get; init; }

    public string CompanyId { get; init; }

    [JsonConstructor]
    public SayHelloCommand(string foo, string companyId) : base()
    {
        Foo = foo;
        CompanyId = companyId;
    }

    public SayHelloCommand(Guid id, DateTime createdAt, string foo, string companyId) : base(id, createdAt)
    {
        Foo = foo;
        CompanyId = companyId;
    }
}