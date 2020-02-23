import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import { Observable } from 'rxjs/Observable';
import { UserDictionary } from '../../type/user-dictionary';

import { MOCK_USER_DICTIONARY_LIST } from './mock-user-dictionary.data';


@Injectable()
export class StubUserDictionaryService {

  private dictList: UserDictionary[] = MOCK_USER_DICTIONARY_LIST;

  constructor(private http: HttpClient) {
  }

  public getUserDictionaryData(): Observable<UserDictionary[]> {
    return Observable.of(this.dictList);
  }

  public addUserDictionaryData(addDict: UserDictionary): void {
    this.dictList.push(addDict);
  }

  public uploadDictionary(file: File) {
    const mockName = new Date().toISOString();
    this.dictList.push({
      id: 0,
      name: mockName,
      items: ['mockItem1', 'mockItem2'],
      description: 'test'
    });
  }

  public deleteUserDictionaryData(dictID: number) {
    this.dictList = this.dictList.filter(dict => dict.id !== dictID);
  }

}
